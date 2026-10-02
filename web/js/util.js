/* ابزارهای عمومی: ارقام فارسی، تاریخ شمسی، آمار و اندیکاتورها */
(function (IM) {
  const U = {};
  const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';

  U.normalize = s => String(s == null ? '' : s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').trim();
  U.digits = s => String(s).replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[٬،]/g, ',');
  U.toNum = v => {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = U.digits(v).replace(/,/g, '').replace('ریال', '').replace('تومان', '').trim();
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  U.num = v => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; };
  U.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
  U.sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------- تاریخ
  const pad = n => String(n).padStart(2, '0');
  U.daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  U.addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  /** تاریخ و ساعت تهران (Intl، بدون وابستگی به منطقه زمانی دستگاه). dow: یکشنبه=0 ... شنبه=6 */
  U.tehranNow = (d = new Date()) => {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d)
      .forEach(p => { parts[p.type] = p.value; });
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const hh = parts.hour === '24' ? '00' : parts.hour;
    return { date: `${parts.year}-${parts.month}-${parts.day}`, dow, hm: `${hh}:${parts.minute}`,
      iso: `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}` };
  };

  /** '1405/07/30' → '2026-10-22' (الگوریتم جلالی استاندارد) */
  U.jalaliToGregorian = s => {
    let [jy, jm, jd] = String(U.digits(s)).replace(/-/g, '/').split('/').map(Number);
    if (!jy || !jm || !jd) throw new Error('تاریخ شمسی نامعتبر: ' + s);
    jy += 1595;
    let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
      (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    let gy = 400 * Math.floor(days / 146097); days %= 146097;
    if (days > 36524) {
      days -= 1; gy += 100 * Math.floor(days / 36524); days %= 36524;
      if (days >= 365) days += 1;
    }
    gy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const ml = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0;
    while (gm < 13 && gd > ml[gm]) { gd -= ml[gm]; gm++; }
    return `${gy}-${pad(gm)}-${pad(gd)}`;
  };
  U.yyyymmdd = v => { const s = String(v || ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };

  // ---------------------------------------------------------------- آمار
  const valid = x => x != null && !Number.isNaN(x);
  U.mean = a => { const v = a.filter(valid); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  U.std = a => { const v = a.filter(valid); if (v.length < 2) return NaN; const m = U.mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
  U.median = a => { const v = a.filter(valid).sort((x, y) => x - y); if (!v.length) return NaN; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
  U.last = (a, k = 1) => a[a.length - k];
  U.rollMean = (a, n) => a.length >= n ? U.mean(a.slice(-n)) : NaN;
  U.rollStd = (a, n) => a.length >= n ? U.std(a.slice(-n)) : NaN;
  /** میانگین متحرک نمایی مثل pandas ewm(adjust=False) */
  U.ewm = (a, alpha) => { const o = []; let y = null; for (const x of a) { y = y == null ? x : alpha * x + (1 - alpha) * y; o.push(y); } return o; };
  U.ema = (a, span) => U.ewm(a, 2 / (span + 1));
  U.rsi = (c, n = 14) => {
    if (c.length < 2) return NaN;
    const d = c.slice(1).map((x, i) => x - c[i]);
    const up = U.ewm(d.map(x => Math.max(x, 0)), 1 / n), dn = U.ewm(d.map(x => Math.max(-x, 0)), 1 / n);
    const u = U.last(up), v = U.last(dn);
    return v === 0 ? (u > 0 ? 100 : 50) : 100 - 100 / (1 + u / v);
  };
  U.macd = c => { const e12 = U.ema(c, 12), e26 = U.ema(c, 26); const m = e12.map((x, i) => x - e26[i]); return [m, U.ema(m, 9)]; };
  U.atr = (rows, n = 14) => {
    const tr = rows.map((r, i) => i === 0 ? r.high - r.low :
      Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close)));
    return tr.length >= n ? U.mean(tr.slice(-n)) : NaN;
  };
  U.pct = (c, n) => (c.length <= n || c[c.length - n - 1] === 0) ? null : (c[c.length - 1] / c[c.length - n - 1] - 1) * 100;
  U.erf = x => { // Abramowitz-Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  U.nlargest = (rows, key, n) => rows.filter(r => valid(r[key])).sort((a, b) => b[key] - a[key]).slice(0, n);
  U.nsmallest = (rows, key, n) => rows.filter(r => valid(r[key])).sort((a, b) => a[key] - b[key]).slice(0, n);
  U.round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; };
  U.fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

  // ---------------------------------------------------------------- ادغام و تفاضل تنظیمات
  U.isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  /** b را روی a ادغام می‌کند (شیءها عمیق، آرایه‌ها و مقدارها جایگزین) */
  U.merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b || {})) o[k] = U.isObj(a[k]) && U.isObj(b[k]) ? U.merge(a[k], b[k]) : b[k]; return o; };
  /** فقط بخش‌هایی از c که با پیش‌فرض d فرق دارد؛ تا تغییر فهرست‌های پیش‌فرض در نسخه‌های بعدی اعمال شود */
  U.diff = (d, c) => {
    const out = {};
    for (const k of Object.keys(c || {})) {
      if (U.isObj(d[k]) && U.isObj(c[k])) { const x = U.diff(d[k], c[k]); if (Object.keys(x).length) out[k] = x; }
      else if (JSON.stringify(d[k]) !== JSON.stringify(c[k])) out[k] = c[k];
    }
    return out;
  };

  IM.U = U;
})(window.IM = window.IM || {});
