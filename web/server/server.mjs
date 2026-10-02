// اجرا (در Termux):   node server.mjs [پورت]
// بعد در مرورگر گوشی باز کن:   http://127.0.0.1:8787/   (آدرس دقیق در همین پنجره نوشته می‌شود)
// اگر پورت پر باشد: اگر همان داشبورد از قبل باز است فقط آدرسش را می‌گوید؛ اگر برنامه‌ی دیگری است پورت بعدی را امتحان می‌کند.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp } from './app.mjs';

const FIRST = Number(process.argv[2] || process.env.PORT || 8787);
const TRIES = 11;                         // ۸۷۸۷ تا ۸۷۹۷
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(os.homedir(), '.iran_market_dashboard');
const handler = makeApp({ webRoot, dataDir });

/** آیا روی این پورت همین داشبورد از قبل باز است؟ */
async function isOurServer(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).ok === true;
  } catch (e) { return false; }
}

const listen = port => new Promise((resolve, reject) => {
  const s = http.createServer(handler);
  s.once('error', reject);
  s.listen(port, '127.0.0.1', () => resolve(s));
});

for (let i = 0; i < TRIES; i++) {
  const port = FIRST + i;
  try {
    await listen(port);
    console.log(`داشبورد آماده است:  http://127.0.0.1:${port}/`);
    console.log('این پنجره‌ی Termux را باز نگه دار. برای توقف: Ctrl+C');
    break;
  } catch (e) {
    if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
    if (await isOurServer(port)) {
      console.log(`سرور داشبورد از قبل روی همین پورت باز است؛ همان را استفاده کن:  http://127.0.0.1:${port}/`);
      console.log('(اگر می‌خواهی دوباره شروع شود، پنجره‌ی Termux قبلی را ببند یا Ctrl+C بزن و دوباره اجرا کن.)');
      process.exit(0);
    }
    console.log(`پورت ${port} را برنامه‌ی دیگری گرفته؛ پورت ${port + 1} را امتحان می‌کنم…`);
    if (i === TRIES - 1) { console.error('هیچ پورت آزادی بین ۸۷۸۷ تا ۸۷۹۷ پیدا نشد. یک پورت دلخواه بده: node server.mjs 9000'); process.exit(1); }
  }
}
