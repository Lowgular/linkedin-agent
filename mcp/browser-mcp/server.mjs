#!/usr/bin/env node
import { createServer as httpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BrowserState } from './browser.mjs';
import { createServer } from './tools.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// A hook is a module whose default export the service awaits at its point; loaded once, at start.
async function loadHook(file) {
  if (!file) return undefined;
  const hook = (await import(pathToFileURL(path.resolve(file)).href)).default;
  if (typeof hook !== 'function') throw new Error(`Hook ${file} has no default export function.`);
  return hook;
}
// The browser it attaches to, as health and the log say it: the address without its query, which may hold a token.
const shown = cdp => cdp.replace(/\?.*$/, '');
export async function serve({ port = 9333, host = '127.0.0.1', cdp, stateFile = path.join(root, '.runtime/state.json'), hooks = {}, steel = {}, hostMap = {} } = {}) {
  if (!cdp) throw new Error('No browser: set BROWSER_MCP_CDP to a CDP address (http(s):// or ws(s)://) or a session API (…/v1/sessions).');
  const loaded = { onConnect: await loadHook(hooks.onConnect), beforeNavigation: await loadHook(hooks.beforeNavigation), afterAction: await loadHook(hooks.afterAction), afterNavigation: await loadHook(hooks.afterNavigation) };
  const state = await new BrowserState({ cdp, stateFile, hooks: loaded, steel, hostMap }).init();
  const server = httpServer(async (req, res) => {
    // Loopback only, with Host and Origin checks against browser-origin requests/DNS rebinding.
    const host = req.headers.host;
    const hosts = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
    if (!hosts.has(host) || req.headers.origin) { res.writeHead(403).end('Local MCP clients only'); return; }
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ service: 'browser-mcp', version: '0.1.0', browser: shown(cdp), sessions: Object.keys(state.sessions).length })); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    const mcp = createServer(state);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP request failed:', error.message);
      if (!res.headersSent) res.writeHead(500).end('MCP request failed');
    }
  });
  server.requestTimeout = 130000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { state, server, browser: shown(cdp), close: async () => { await new Promise(resolve => server.close(resolve)); await state.disconnect(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = process.env;
  const service = await serve({ port: Number(env.BROWSER_MCP_PORT ?? 9333), host: env.BROWSER_MCP_HOST ?? '127.0.0.1', cdp: env.BROWSER_MCP_CDP, stateFile: env.BROWSER_MCP_STATE_FILE ?? path.join(root, '.runtime', `${(env.BROWSER_MCP_CDP ?? '').replace(/[^a-z0-9]+/gi, '-')}.json`), hooks: { onConnect: env.BROWSER_MCP_HOOKS_ON_CONNECT, beforeNavigation: env.BROWSER_MCP_HOOKS_BEFORE_NAVIGATION, afterAction: env.BROWSER_MCP_HOOKS_AFTER_ACTION, afterNavigation: env.BROWSER_MCP_HOOKS_AFTER_NAVIGATION },
    steel: { key: env.STEEL_API_KEY, timeout: Number(env.STEEL_SESSION_TIMEOUT ?? 900000), profile: env.BROWSER_MCP_PROFILE },
    hostMap: Object.fromEntries((env.BROWSER_MCP_MAP_HOSTS ?? '').split(',').map(e => e.trim()).filter(Boolean).map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)])) });
  console.log(`browser-mcp listening at http://127.0.0.1:${service.server.address().port}/mcp, on the browser at ${service.browser}`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await service.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
