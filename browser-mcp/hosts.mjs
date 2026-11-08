// Hosts answered from elsewhere: mapHosts(context, { 'www.example.com': 'https://mirror.example.net/www' }) makes the
// browser's every request to a mapped host a fetch of the same path under its base, done here, so the page keeps the
// host's own address — whatever the browser, a cloud one included, since nothing has to resolve differently. A
// redirect to one of the bases is sent back as the host it stands for; an on-connect hook is where it is set up.
const KEEP = ['content-type', 'cache-control', 'last-modified', 'etag'];
const MOVED = 'data-browser-mcp-moved';

export async function mapHosts(context, map) {
  const bases = Object.entries(map).map(([host, base]) => [host, base.replace(/\/+$/, '')]);
  const targets = new Map(bases);
  // back: an address under one of the bases, as its host's (the longest base that holds it).
  const back = location => {
    const [host, base] = bases.filter(([, b]) => location === b || location.startsWith(b + '/')).sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    return host ? `https://${host}${location.slice(base.length) || '/'}` : location;
  };
  await context.route(u => targets.has(u.hostname), async route => {
    const request = route.request();
    const u = new URL(request.url());
    const target = targets.get(u.hostname) + u.pathname + u.search;
    try {
      const headers = await request.allHeaders();
      // A redirect the browser followed would leave the route, to the real host: a page is moved on by the page
      // itself, a new navigation, routed again; anything else has its redirects followed here.
      const page = request.isNavigationRequest();
      const r = await fetch(target, { method: request.method(), body: request.postDataBuffer() ?? undefined, redirect: page ? 'manual' : 'follow', headers: { accept: headers.accept || '*/*', 'user-agent': headers['user-agent'] || 'browser-mcp', ...(headers['content-type'] ? { 'content-type': headers['content-type'] } : {}) } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        const to = back(new URL(r.headers.get('location'), target).href);
        return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<!DOCTYPE html><html ${MOVED}><script>location.replace(${JSON.stringify(to)})</script>` });
      }
      const kept = {};
      for (const k of KEEP) if (r.headers.get(k)) kept[k] = r.headers.get(k);
      return route.fulfill({ status: r.status, headers: kept, body: Buffer.from(await r.arrayBuffer()) });
    } catch (error) {
      return route.fulfill({ status: 502, contentType: 'text/plain; charset=utf-8', body: `${target} did not answer: ${error.message}\n` });
    }
  });
}

// Once a page has loaded: past a mapped redirect's page that moves itself on, to the page it moves to.
export async function settled(page) {
  if (!await page.evaluate(m => document.documentElement.hasAttribute(m), MOVED).catch(() => false)) return;
  await page.waitForFunction(m => !document.documentElement.hasAttribute(m), MOVED, { timeout: 15000 });
  await page.waitForLoadState('domcontentloaded');
}
