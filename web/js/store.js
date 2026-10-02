/* ذخیره‌سازی محلی (localStorage) به‌جای SQLite: قیمت‌ها، اخبار، تاریخچه سیگنال، کش نماد.
   حالت دمو با ns جدا کار می‌کند تا داده واقعی خراب نشود. اگر localStorage در دسترس نبود، در حافظه می‌ماند. */
(function (IM) {
  const mem = {};
  const Store = {
    ns: 'im',
    _k(k) { return `${this.ns}.${k}`; },
    get(k, def) {
      const nk = this._k(k);
      try { const v = localStorage.getItem(nk); if (v != null) return JSON.parse(v); } catch (e) { /* ignore */ }
      return mem[nk] !== undefined ? mem[nk] : def;
    },
    set(k, v) {
      mem[this._k(k)] = v;
      try { localStorage.setItem(this._k(k), JSON.stringify(v)); } catch (e) { /* پر یا مسدود */ }
    },
    clearNs() {
      try { Object.keys(localStorage).filter(k => k.startsWith(this.ns + '.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
      Object.keys(mem).filter(k => k.startsWith(this.ns + '.')).forEach(k => delete mem[k]);
    },

    // ---------------- قیمت‌ها: {date: {name: price}}
    savePrices(prices, date) {
      const all = this.get('prices', {});
      const day = all[date] || (all[date] = {});
      for (const [k, v] of Object.entries(prices)) if (v) day[k] = Number(v);
      const keys = Object.keys(all).sort();
      while (keys.length > 600) delete all[keys.shift()];
      this.set('prices', all);
    },
    /** سابقه‌ی دریافت‌شده از سایت‌ها: {name: [[date, price], ...]}. روزهای قبل از before بازنویسی می‌شوند؛ روز before فقط اگر قیمت زنده‌ای ثبت نشده باشد */
    backfillPrices(series, before) {
      const all = this.get('prices', {});
      for (const [name, rows] of Object.entries(series || {}))
        for (const [d, v] of rows || []) {
          if (!d || !(v > 0) || d > before || (d === before && (all[d] || {})[name])) continue;
          (all[d] || (all[d] = {}))[name] = Number(v);
        }
      const keys = Object.keys(all).sort();
      while (keys.length > 600) delete all[keys.shift()];
      this.set('prices', all);
    },
    lastPrice(name) { const s = this._series(name); return s.length ? s[s.length - 1][1] : null; },
    /** سری قیمت یک نام: [[date, price], ...] مرتب. all را می‌شود از بیرون داد تا هر بار JSON دوباره خوانده نشود. */
    _series(name, all = this.get('prices', {})) { return Object.keys(all).sort().filter(d => all[d][name]).map(d => [d, all[d][name]]); },
    /** maxDays (اختیاری): نقطه‌ی مبنا نباید قدیمی‌تر از این باشد (وقتی سابقه پراکنده است) */
    changePct(name, price, days, today, maxDays) {
      const lim = IM.U.addDays(today, -days), oldest = maxDays ? IM.U.addDays(today, -maxDays) : '';
      const row = this._series(name).filter(([d]) => d <= lim && d >= oldest).pop();
      return row && row[1] ? (price / row[1] - 1) * 100 : null;
    },
    /** تابع (name, d) → تغییر درصدی از روز d تا اولین روز ثبت‌شده بعدی؛ قیمت‌ها فقط یک بار خوانده می‌شوند */
    nextChangeFn() {
      const all = this.get('prices', {}), cache = {};
      return (name, d) => {
        const s = cache[name] || (cache[name] = this._series(name, all));
        const a = s.filter(([x]) => x <= d).pop(), b = s.find(([x]) => x > d);
        return a && b && a[1] ? (b[1] / a[1] - 1) * 100 : null;
      };
    },
    nextChange(name, d) { return this.nextChangeFn()(name, d); },

    // ---------------- اخبار
    saveNews(items, date) {
      const all = this.get('news', []);
      const seen = new Set(all.map(n => n.title));
      for (const it of items) if (!seen.has(it.title)) { seen.add(it.title); all.push({ title: it.title, d: date, rule: it.impact || [] }); }
      this.set('news', all.slice(-4000));
    },

    // ---------------- سیگنال‌ها: آخرین وضعیت هر نماد
    changedSignals(signals) {
      const last = this.get('lastAction', {}), out = [];
      for (const s of signals) {
        if (s.action !== 'HOLD' && last[s.symbol] !== s.action) out.push(s);
        last[s.symbol] = s.action;
      }
      this.set('lastAction', last);
      return out;
    },

    // ---------------- کش نماد → کد
    inscodes() { return this.get('inscodes', {}); },
    saveInscodes(c) { this.set('inscodes', c); },
  };
  IM.Store = Store;
})(window.IM = window.IM || {});
