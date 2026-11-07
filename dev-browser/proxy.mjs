#!/usr/bin/env node
// dev-browser/proxy.mjs — the world, under its hosts' own names. The browser resolves the world's hosts to this
// proxy (start.sh), and every request is fetched from the site the world is published at: the first host's paths
// at the site's root, another host's under /__h/<host> — the layout world/deploy.sh publishes. A redirect is
// sent back under the host's name; the pages' click reports (POST /__log) are kept here, in the log.
//
//   WORLD_URL    the site, e.g. https://linkedin-stub.web.app
//   WORLD_HOSTS  the hosts, comma-separated; the first is the site's root
//   WORLD_LOG    the click log (default /logs/agent/faker-clicks.jsonl); TLS from /opt/tls, on port 4443
import http from 'node:http';
import https from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const site = new URL(process.env.WORLD_URL || '');
const base = site.origin + site.pathname.replace(/\/+$/, '');
const [root, ...others] = (process.env.WORLD_HOSTS || 'www.linkedin.com').split(',').map(h => h.trim()).filter(Boolean);
const known = new Set([root, ...others]);
const logFile = process.env.WORLD_LOG || '/logs/agent/faker-clicks.jsonl';
const port = Number(process.env.WORLD_PORT || 4443);
const tls = existsSync('/opt/tls/cert.pem') ? { cert: readFileSync('/opt/tls/cert.pem'), key: readFileSync('/opt/tls/key.pem') } : null;
const KEEP = ['content-type', 'cache-control', 'last-modified', 'etag'];

const log = entry => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  mkdirSync(path.dirname(logFile), { recursive: true });
  appendFileSync(logFile, line + '\n');
};
const prefix = h => (h === root ? '' : '/__h/' + h);
// back: an address on the site, as the host it stands for.
const back = (location, asked) => {
  const u = new URL(location, base + '/');
  if (u.origin !== site.origin) return u.href;
  const rest = u.pathname.slice(site.pathname.replace(/\/+$/, '').length);
  const m = rest.match(/^\/__h\/([^/]+)(\/.*)?$/);
  return m ? `https://${m[1]}${m[2] || '/'}${u.search}` : `${asked}${rest}${u.search}`;
};

const handler = async (req, res) => {
  const named = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const h = known.has(named) ? named : root;   // by the proxy's own address (localhost): the root host
  const url = new URL(req.url, 'http://proxy');
  if (url.pathname === '/__log') {
    if (req.method !== 'POST') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { try { log({ ...JSON.parse(body), source: 'player' }); } catch { log({ type: 'bad-report', body }); } res.writeHead(204).end(); });
    return;
  }
  const target = base + prefix(h) + url.pathname + url.search;
  try {
    const r = await fetch(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', redirect: 'manual', headers: { accept: req.headers.accept || '*/*', 'user-agent': req.headers['user-agent'] || 'dev-browser' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const asked = known.has(named) ? `https://${h}` : `${tls ? 'https' : 'http'}://${req.headers.host}`;
      res.writeHead(r.status, { location: back(r.headers.get('location'), asked), 'cache-control': 'no-store' }).end();
      return;
    }
    if (r.status === 404 && (req.headers['sec-fetch-dest'] || 'document') === 'document') log({ type: 'miss', page: h + url.pathname });
    const headers = {};
    for (const k of KEEP) if (r.headers.get(k)) headers[k] = r.headers.get(k);
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...headers, 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    log({ type: 'upstream-error', url: target, error: error.message });
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`The world at ${base} did not answer: ${error.message}\n`);
  }
};

(tls ? https.createServer(tls, handler) : http.createServer(handler)).listen(port, '127.0.0.1', () => {
  console.log(`▸ the world at ${base}, as ${[...known].join(', ')}, on ${tls ? 'https' : 'http'}://127.0.0.1:${port}; clicks in ${logFile}`);
});
