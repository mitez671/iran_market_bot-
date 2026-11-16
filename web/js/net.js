/* شبکه: fetch مستقیم از مرورگر با timeout و قطع‌کننده مدار برای هر میزبان (از شبکه/VPN خود دستگاه استفاده می‌شود).
   اگر اتصال به یک میزبان چند بار شکست بخورد، بقیه درخواست‌های همان چرخه فوراً رد می‌شوند. */
(function (IM) {
  const Net = {
    timeout: 15000,   // میلی‌ثانیه؛ مرورگر زمان اتصال و خواندن را جدا نمی‌کند
    threshold: 2,
    fails: {}, down: new Set(),

    android: typeof window.AndroidDashboard !== 'undefined' ? window.AndroidDashboard : null,

    async fetch(url, options = {}) {
      if (!Net.android) return fetch(url, options);
      const { method = 'GET', headers, body, timeout = 60000, signal } = options;
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = Net.android.prepare(JSON.stringify({
        url, method, headers: Object.fromEntries(new Headers(headers)), body, timeout,
      }));
      if (!id) throw new Error('درخواست شبکه آماده نشد');
      const cancel = () => Net.android.cancel(id);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await fetch('/native/' + id, { signal, cache: 'no-store' });
        // Read the stream before releasing the native call, including HTTP error bodies.
        if (response.headers.get('X-Dashboard-Network-Error')) throw new Error('اتصال برقرار نشد');
        const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
        return new Response(body, { status: response.status, statusText: response.statusText });
      } finally {
        if (signal) signal.removeEventListener('abort', cancel);
        cancel();
      }
    },

    reset() { this.fails = {}; this.down = new Set(); },

    async request(url, { method = 'GET', body, headers, as = 'text', timeout } = {}) {
      const host = new URL(url).hostname;
      if (this.down.has(host)) throw new Error(`${host} در این چرخه در دسترس نبود؛ رد شد`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout || this.timeout);
      let resp;
      try {
        resp = await this.fetch(url, { method, body, headers, timeout: timeout || this.timeout, signal: ctl.signal, cache: 'no-store' });
      } catch (e) {
        this.fails[host] = (this.fails[host] || 0) + 1;
        if (this.fails[host] >= this.threshold) this.down.add(host);
        const hint = this.android ? ' (اینترنت یا VPN دستگاه را چک کن)' : typeof document !== 'undefined' ? ' (اگر اینترنت/VPN وصل است، احتمالاً مرورگر به‌خاطر CORS اجازه‌ی خواندن این سایت را نمی‌دهد)'
          : ' (سرور ترموکس به این سایت وصل نشد؛ اینترنت یا VPN دستگاه را چک کن)';
        throw new Error(`${host}: ${e.name === 'AbortError' ? 'timeout' : 'اتصال برقرار نشد'}${hint}`);
      } finally { clearTimeout(timer); }
      this.fails[host] = 0;
      if (!resp.ok) throw new Error(`${host}: HTTP ${resp.status}`);
      return as === 'json' ? resp.json() : resp.text();
    },
    get(url, opt) { return this.request(url, opt); },
    json(url, opt) { return this.request(url, { ...opt, as: 'json' }); },
    postJson(url, payload, opt) {
      return this.request(url, { ...opt, method: 'POST', as: 'json', body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    },
  };
  IM.Net = Net;
})(window.IM = window.IM || {});
