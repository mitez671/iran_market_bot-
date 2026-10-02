// سرور محلی داشبورد (Node، بدون هیچ وابستگی). روی خود گوشی (Termux) اجرا می‌شود و فقط به 127.0.0.1 گوش می‌دهد.
//  - صفحه‌ی داشبورد را سرو می‌کند (آدرس محلی)
//  - GET/PUT /api/settings: تنظیمات صفحه (بدون کلید API و توکن‌ها) در dataDir/settings.json روی خود گوشی، تا با عوض شدن پورت یا پاک شدن داده‌های مرورگر از دست نرود
//  - POST /api/collect: سایت‌های خواسته‌شده را از شبکه‌ی خود دستگاه می‌گیرد (با VPN دستگاه، اگر روشن باشد) و نتیجه را به صفحه برمی‌گرداند
// منطق دریافت همان js/collect.js و js/sources.js و js/tsetmc.js صفحه است (یک نسخه، دو جا اجرا نمی‌شود).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import dns from 'node:dns/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// ---------------------------------------------------------------- fetch امن (جلوگیری از رسیدن به شبکه‌ی خانگی/خود دستگاه)
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:') && net.isIPv4(x.slice(7))) return isPrivateAddress(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}

export async function safeFetch(url, opts = {}) {
  let cur = new URL(url), method = opts.method || 'GET', body = opts.body;
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:$/.test(cur.protocol)) throw new TypeError('protocol not allowed');
    const host = cur.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some(a => isPrivateAddress(a.address))) throw new TypeError(`private address blocked: ${host}`);
    const referer = /tsetmc\.com$/.test(cur.hostname) ? 'https://www.tsetmc.com/' : /tgju\.org$/.test(cur.hostname) ? 'https://www.tgju.org/' : cur.origin + '/';
    const r = await fetch(cur.href, { method, body, signal: opts.signal, redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.5', Referer: referer, ...(opts.headers || {}) } });
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) {
      cur = new URL(r.headers.get('location'), cur);
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
      continue;
    }
    return r;
  }
  throw new TypeError('too many redirects');
}

// ---------------------------------------------------------------- هسته: همان ماژول‌های صفحه داخل vm
function fileStorage(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* اولین اجرا */ }
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { /* ignore */ } },
    removeItem: k => { delete data[k]; },
  };
}
const CORE = ['util', 'net', 'store', 'tsetmc', 'sources', 'collect'];
/** آخرین زمان تغییر فایل‌های هسته؛ اگر عوض شد هسته دوباره بارگذاری می‌شود (بعد از به‌روزرسانی برنامه لازم نیست سرور را دوباره اجرا کنی) */
const coreStamp = jsDir => CORE.map(f => { try { return fs.statSync(path.join(jsDir, f + '.js')).mtimeMs; } catch (e) { return 0; } }).join(',');
function loadCore(jsDir, fetchImpl, storage) {
  const ctx = { console, URL, AbortController, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Float32Array, TextDecoder, fetch: fetchImpl, localStorage: storage };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of CORE) vm.runInContext(fs.readFileSync(path.join(jsDir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  return ctx.IM;
}

// ---------------------------------------------------------------- هندلر HTTP
export function makeApp({ webRoot, dataDir, fetchImpl = safeFetch }) {
  const jsDir = path.join(webRoot, 'js'), storage = fileStorage(path.join(dataDir, 'storage.json'));
  let IM = loadCore(jsDir, fetchImpl, storage), stamp = coreStamp(jsDir);
  const freshCore = () => {
    const now = coreStamp(jsDir);
    if (now !== stamp) {
      try { IM = loadCore(jsDir, fetchImpl, storage); stamp = now; console.log('فایل‌های برنامه عوض شده بود؛ دوباره بارگذاری شد.'); }
      catch (e) { console.log('بارگذاری دوباره ناموفق، نسخه‌ی قبلی می‌ماند:', e.message); }
    }
    return IM;
  };
  const bundle = { sources: {} };          // آخرین نتایج در حافظه‌ی سرور (برای پیدا کردن کد نماد از دیده‌بان)
  let busy = false;

  const send = (res, code, text, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(text); };
  const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
  });

  /** درخواست‌های نوشتنی فقط از صفحه‌ی خود داشبورد؛ اگر رد شد پاسخ را می‌فرستد و false برمی‌گرداند */
  function guard(req, res) {
    const h = req.headers;
    if (!/^application\/json/i.test(h['content-type'] || '')) return send(res, 415, 'content-type must be application/json'), false;
    if (h.origin && !LOCAL_HOST.test(h.origin.replace(/^https?:\/\//, ''))) return send(res, 403, 'bad origin'), false;
    if (h['sec-fetch-site'] && !['same-origin', 'none'].includes(h['sec-fetch-site'])) return send(res, 403, 'cross-site request blocked'), false;
    return true;
  }

  const settingsFile = path.join(dataDir, 'settings.json');
  async function settings(req, res) {
    if (req.method === 'GET') {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(res, 403, 'cross-site request blocked');
      let text = 'null';
      try { text = JSON.stringify(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (e) { /* هنوز ذخیره نشده */ }
      return send(res, 200, text, MIME['.json']);
    }
    if (!guard(req, res)) return;
    let body;
    try { body = JSON.parse(await readBody(req, 1e6)); } catch (e) { return send(res, 400, 'bad json'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, 'settings must be an object');
    delete body.llm; delete body.notify;                       // کلید و توکن روی دیسک نوشته نمی‌شود
    const tmp = settingsFile + '.tmp';
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(body, null, 1));
    fs.renameSync(tmp, settingsFile);                           // نوشتن اتمی: فایل نیمه‌کاره نمی‌ماند
    send(res, 200, '{"ok":true}', MIME['.json']);
  }

  async function collect(req, res) {
    if (!guard(req, res)) return;
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, 'bad json'); }
    const { cfg, ids } = body || {};
    if (!cfg || typeof cfg !== 'object' || !Array.isArray(ids) || !ids.length || ids.length > 300 || ids.some(i => typeof i !== 'string')) return send(res, 400, 'bad request');
    if (busy) return send(res, 409, 'یک دریافت دیگر هنوز در حال اجراست');
    busy = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = o => { if (!res.destroyed) res.write(JSON.stringify(o) + '\n'); };
    try {
      await freshCore().Collect.run(cfg, bundle, ids, { progress: (done, total, id) => write({ type: 'progress', done, total, id }) });
      write({ type: 'done', sources: Object.fromEntries(ids.map(id => [id, bundle.sources[id]])) });
    } catch (e) { write({ type: 'error', message: String(e.message || e) }); }
    finally { busy = false; res.end(); }
  }

  function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    if (!/^(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js)$/.test(rel)) return send(res, 404, 'not found');
    const file = path.join(webRoot, rel);
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'not found') : (res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }), res.end(buf)));
  }

  return async (req, res) => {
    try {
      if (!LOCAL_HOST.test(req.headers.host || '')) return send(res, 403, 'bad host');       // محافظت در برابر DNS rebinding
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/ping' && req.method === 'GET') return send(res, 200, JSON.stringify({ ok: true, node: process.version, busy }), MIME['.json']);
      if (url.pathname === '/api/settings' && ['GET', 'PUT'].includes(req.method)) return await settings(req, res);
      if (url.pathname === '/api/collect' && req.method === 'POST') return await collect(req, res);
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res);
      send(res, 405, 'method not allowed');
    } catch (e) { if (!res.headersSent) send(res, 500, String(e.message || e)); else res.end(); }
  };
}
