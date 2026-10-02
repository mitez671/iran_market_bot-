/* شبکه: fetch مستقیم از مرورگر با timeout و قطع‌کننده مدار برای هر میزبان (از شبکه/VPN خود دستگاه استفاده می‌شود).
   اگر اتصال به یک میزبان چند بار شکست بخورد، بقیه درخواست‌های همان چرخه فوراً رد می‌شوند. */
(function (IM) {
  const Net = {
    timeout: 15000,   // میلی‌ثانیه؛ مرورگر زمان اتصال و خواندن را جدا نمی‌کند
    threshold: 2,
    fails: {}, down: new Set(),

    reset() { this.fails = {}; this.down = new Set(); },

    async request(url, { method = 'GET', body, headers, as = 'text', timeout } = {}) {
      const host = new URL(url).hostname;
      if (this.down.has(host)) throw new Error(`${host} در این چرخه در دسترس نبود؛ رد شد`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout || this.timeout);
      let resp;
      try {
        resp = await fetch(url, { method, body, headers, signal: ctl.signal, cache: 'no-store' });
      } catch (e) {
        this.fails[host] = (this.fails[host] || 0) + 1;
        if (this.fails[host] >= this.threshold) this.down.add(host);
        const hint = typeof document !== 'undefined' ? ' (اگر اینترنت/VPN وصل است، احتمالاً مرورگر به‌خاطر CORS اجازه‌ی خواندن این سایت را نمی‌دهد)'
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
