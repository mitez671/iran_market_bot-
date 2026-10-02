/* TSETMC: سابقه قیمت، حقیقی/حقوقی، شاخص‌ها، دیده‌بان کل بازار، اوراق و غربالگری.
   اگر TSETMC ساختار پاسخ را عوض کند، فقط همین فایل باید به‌روز شود. */
(function (IM) {
  const { U, Net, Store } = IM;
  const BASE = 'https://cdn.tsetmc.com/api';
  const T = {};

  T.get = async (path, retries = 2) => {
    let last;
    for (let i = 0; i < retries; i++) {
      try { return await Net.json(BASE + path); } catch (e) {
        last = e;
        if (/رد شد/.test(e.message)) break;       // میزبان مسدود شده: تلاش دوباره بی‌فایده است
        if (i < retries - 1) await U.sleep(1000 * (i + 1));
      }
    }
    throw new Error(`TSETMC ${path} -> ${last.message}`);
  };

  // ---------------------------------------------------------------- نماد → کد
  T.resolve = async (symbol, mwIndex) => {
    const sym = U.normalize(symbol);
    const cache = Store.inscodes();
    if (cache[sym]) return cache[sym];
    if (mwIndex && mwIndex[sym]) {               // از دیده‌بان کل بازار (بدون درخواست جستجو)
      const r = mwIndex[sym];
      return (cache[sym] = { ins_code: String(r.ins_code), symbol: sym, name: U.normalize(r.name) }, Store.saveInscodes(cache), cache[sym]);
    }
    let cands = [];
    for (const q of new Set([sym, sym.replace(/ی/g, 'ي').replace(/ک/g, 'ك')])) {
      try { cands = cands.concat((await T.get(`/Instrument/GetInstrumentSearch/${encodeURIComponent(q)}`)).instrumentSearch || []); }
      catch (e) { console.warn(e.message); }
    }
    const exact = cands.filter(c => U.normalize(c.lVal18AFC) === sym).sort((a, b) => (+b.lastDate || 0) - (+a.lastDate || 0));
    if (!exact.length) { console.warn('نماد پیدا نشد:', symbol); return null; }
    const info = { ins_code: String(exact[0].insCode), symbol: sym, name: U.normalize(exact[0].lVal30) };
    cache[sym] = info; Store.saveInscodes(cache);
    return info;
  };

  // ---------------------------------------------------------------- سابقه
  T.history = async (insCode, n = 250) => {
    const rows = (await T.get(`/ClosingPrice/GetClosingPriceDailyList/${insCode}/${n}`)).closingPriceDaily || [];
    return rows.map(r => ({ date: U.yyyymmdd(r.dEven), open: r.priceFirst, high: r.priceMax, low: r.priceMin,
      close: r.pClosing, last: r.pDrCotVal, yesterday: r.priceYesterday, volume: r.qTotTran5J || 0, value: r.qTotCap, count: r.zTotTran }))
      .filter(r => r.date && r.volume > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  };

  T.clientType = async insCode => {
    const rows = (await T.get(`/ClientType/GetClientTypeHistory/${insCode}`)).clientType || [];
    return rows.map(r => ({
      date: U.yyyymmdd(r.recDate),
      buy_CountI: +(r.buy_I_Count || 0), sell_CountI: +(r.sell_I_Count || 0),
      buy_I_Volume: +(r.buy_I_Volume || 0), sell_I_Volume: +(r.sell_I_Volume || 0),
      buy_N_Volume: +(r.buy_N_Volume || 0), sell_N_Volume: +(r.sell_N_Volume || 0),
    })).filter(r => r.date).sort((a, b) => a.date < b.date ? -1 : 1);
  };

  T.marketOverview = async () => {
    const out = {}; let err;
    for (const [flow, name] of [[1, 'bourse'], [2, 'farabourse']]) {
      try {
        const d = (await T.get(`/MarketData/GetMarketOverview/${flow}`)).marketOverview || {};
        out[name] = { index: d.indexLastValue, index_change: d.indexChange, value: d.marketActivityQTotCap,
          state: d.marketState || d.marketStateTitle };
      } catch (e) { err = e; console.warn(e.message); }
    }
    if (!Object.keys(out).length && err) throw err;   // همه شکست خورد: وضعیت منبع باید ❌ شود
    return out;
  };

  // ---------------------------------------------------------------- سابقه‌ی شاخص‌ها (برای «بازده گذشته»)
  // GetIndexB2History: {indexB2: [{dEven: 20261001, xNivInuClMresIbs: مقدار پایانی, ...}]}
  T.INDEX_HIST = { tedpix: ['32097828799138957', 'شاخص کل'], tedpix_eq: ['67130298613737946', 'شاخص کل (هم‌وزن)'], ifx: ['43685683301327984', 'شاخص کل فرابورس'] };
  T.indexHistory = async insCode => {
    const d = await T.get(`/Index/GetIndexB2History/${insCode}`);
    const rows = (d && (d.indexB2 || Object.values(d).find(Array.isArray))) || [];
    if (!rows.length) throw new Error('سابقه‌ی خالی؛ فیلدها: ' + Object.keys(d || {}).join(','));
    const vk = ['xNivInuClMresIbs', 'xNivInuPbMresIbs', 'indexValue', 'value'].find(k => rows[0][k] != null) || Object.keys(rows[0]).find(k => /Cl/i.test(k) && +rows[0][k] > 0);
    if (!vk) throw new Error('مقدار شاخص در پاسخ نبود؛ فیلدها: ' + Object.keys(rows[0]).join(','));
    return rows.map(r => [U.yyyymmdd(r.dEven), +r[vk]]).filter(([dt, v]) => dt && v > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };
  T.indexHistories = async () => {
    const out = {}, errs = [];
    await Promise.all(Object.entries(T.INDEX_HIST).map(async ([name, [ins, label]]) => {
      try { out[name] = await T.indexHistory(ins); } catch (e) { errs.push(`${label}: ${e.message}`); }
    }));
    if (!Object.keys(out).length) throw new Error(errs.join(' | '));
    if (errs.length) console.warn('سابقه‌ی شاخص‌ها:', errs.join(' | '));
    return { series: out, msg: Object.entries(out).map(([k, v]) => `${T.INDEX_HIST[k][1]} ${v.length} روز`).join('، ') };
  };

  // ---------------------------------------------------------------- NAV صندوق‌های قابل معامله (برای حباب)
  // پاسخ GetETFByInsCode: {etf: {pRedTran: NAV ابطال، pSubTran: NAV صدور، deven: تاریخ}}. اسم فیلدها با چند حالت امتحان می‌شود؛
  // اگر هیچ‌کدام نبود، اسم فیلدهای پاسخ در پیام خطا می‌آید تا بشود این تابع را اصلاح کرد.
  T.fundNav = async insCode => {
    const d = await T.get(`/Fund/GetETFByInsCode/${insCode}`, 1);
    const o = (d && (d.etf || d.fund || d.etfData)) || d || {};
    const num = v => (v == null || v === '' || !isFinite(+v) || +v <= 0 ? null : +v);
    const pick = (names, re) => { for (const k of names) if (num(o[k]) != null) return num(o[k]);
      const k = Object.keys(o).find(x => re.test(x) && num(o[x]) != null); return k ? num(o[k]) : null; };
    const cancel = pick(['pRedTran', 'navRed', 'redemptionNav', 'cancelNav'], /red|cancel|ebtal/i);
    if (cancel == null) throw new Error('NAV ابطال در پاسخ نبود؛ فیلدها: ' + Object.keys(o).slice(0, 25).join(','));
    return { cancel, issue: pick(['pSubTran', 'navSub', 'issueNav'], /sub|issue|sodur/i), date: U.yyyymmdd(o.deven ?? o.dEven) || null };
  };
  /** NAV همه‌ی صندوق‌های دیده‌بان (۵ درخواست همزمان). خروجی: {navs: {ins_code: {...}}, msg} */
  T.FUND_CATS = ['صندوق طلا و کالا', 'صندوق اهرمی', 'صندوق درآمد ثابت', 'صندوق سهامی/مختلط'];
  T.fundNavs = async mw => {
    const funds = (mw || []).filter(r => T.FUND_CATS.includes(r.category) && r.ins_code);
    if (!funds.length) throw new Error('صندوقی در دیده‌بان نیست؛ اول «TSETMC — دیده‌بان کل بازار» را دریافت کن');
    const navs = {}; let i = 0, firstErr = '';
    const worker = async () => { while (i < funds.length) { const f = funds[i++];
      try { navs[f.ins_code] = await T.fundNav(f.ins_code); } catch (e) { if (!firstErr) firstErr = `${f.symbol}: ${e.message}`; if (/رد شد/.test(e.message)) return; } } };
    await Promise.all(Array.from({ length: 5 }, worker));
    const n = Object.keys(navs).length;
    if (!n) throw new Error('NAV هیچ صندوقی دریافت نشد — ' + firstErr);
    if (firstErr) console.warn('NAV صندوق‌ها، اولین خطا:', firstErr);
    return { navs, msg: `${n}/${funds.length} صندوق` };
  };

  // ---------------------------------------------------------------- اختیار معامله
  T.parseOptionName = name => {
    const n = U.normalize(name);
    const m = n.match(/(\d[\d,]*)\s*-\s*(1[34]\d{2}\/\d{1,2}\/\d{1,2})/);
    if (!m) return null;
    const flat = n.replace(/ /g, '');
    const kind = flat.includes('اختیارخ') ? 'call' : flat.includes('اختیارف') ? 'put' : null;
    if (!kind) return null;
    const base = n.split('-')[0].replace(/^اختیار\s*[خف]\s*/, '').trim();
    return { kind, strike: parseFloat(m[1].replace(/,/g, '')), expiry_jalali: m[2], underlying: base };
  };

  // ================================================================ دیده‌بان کل بازار
  const FLOW = { 1: 'بورس', 2: 'فرابورس', 3: 'مشتقه', 4: 'پایه فرابورس', 5: 'پایه فرابورس', 6: 'بورس انرژی', 7: 'بورس کالا' };

  async function watchOld() {
    const text = await Net.get('http://old.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0', { timeout: 25000 });
    const sec = text.split('@');
    if (sec.length < 3) throw new Error('پاسخ MarketWatchPlus نامعتبر');
    const rows = [];
    for (const row of sec[2].split(';')) {
      const c = row.split(',');
      if (c.length < 23) continue;
      rows.push({ ins_code: c[0], symbol: U.normalize(c[2]), name: U.normalize(c[3]), open: +c[5], close: +c[6], last: +c[7],
        count: +c[8], volume: +c[9], value: +c[10], low: +c[11], high: +c[12], yesterday: +c[13], eps: c[14] ? +c[14] : null,
        base_volume: +c[15], flow: +c[17], group: c[18], range_max: +c[19], range_min: +c[20], shares: +c[21] });
    }
    const best = {};
    for (const row of (sec[3] || '').split(';')) {
      const c = row.split(',');
      if (c.length === 8 && c[1] === '1') best[c[0]] = { bid: +c[4], ask: +c[5], bid_vol: +c[6], ask_vol: +c[7] };
    }
    return rows.map(r => Object.assign(r, best[r.ins_code] || {}));
  }

  async function watchCdn() {
    const q = [1, 2, 3, 4, 5, 6, 7, 8].map((t, i) => `paperTypes%5B${i}%5D=${t}`).join('&');
    const d = await T.get(`/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&${q}&showTraded=false&withBestLimits=true&hEven=0&RefID=0`);
    const items = d.marketwatch || d.marketWatch || [];
    return items.map(it => {
      const g = (...ks) => { for (const k of ks) if (it[k] != null) return it[k]; return null; };
      const bl = Array.isArray(g('blDs')) ? (g('blDs')[0] || {}) : {};
      return { ins_code: String(g('insCode', 'inscode')), symbol: U.normalize(g('lva', 'lVal18AFC') || ''), name: U.normalize(g('lvc', 'lVal30') || ''),
        open: g('pf', 'priceFirst'), close: g('pcl', 'pClosing'), last: g('pdv', 'pDrCotVal'), count: g('ztt', 'zTotTran'),
        volume: g('qtj', 'qTotTran5J'), value: g('qtc', 'qTotCap'), low: g('pmn', 'priceMin'), high: g('pmx', 'priceMax'),
        yesterday: g('py', 'priceYesterday'), eps: g('eps'), base_volume: g('bv', 'baseVol'), flow: g('flow', 'cComVal'),
        group: g('cs', 'cSecVal'), range_max: g('tmax', 'psGelStaMax'), range_min: g('tmin', 'psGelStaMin'),
        shares: g('z', 'zTitad'), bid: bl.pmd, ask: bl.pmo, bid_vol: bl.qmd, ask_vol: bl.qmo };
    });
  }

  async function clientAll() {
    const text = await Net.get('http://old.tsetmc.com/tsev2/data/ClientTypeAll.aspx', { timeout: 30000 });
    const out = {};
    for (const row of text.split(';')) {
      const c = row.split(',');
      if (c.length !== 9) continue;
      out[c[0]] = { r_buy_n: +c[1], r_buy_v: +c[3], r_sell_n: +c[5], r_sell_v: +c[7], l_buy_v: +c[4], l_sell_v: +c[8] };
    }
    return out;
  }

  T.classify = (symbol, name) => {
    const s = symbol || '', n = name || '';
    if (/^اختیار ?خ/.test(n)) return 'اختیار خرید';
    if (/^اختیار ?ف/.test(n)) return 'اختیار فروش';
    if (n.includes('آتی')) return 'آتی';
    if (s.startsWith('اخزا') || n.includes('اسناد خزانه') || n.includes('اسنادخزانه')) return 'اسناد خزانه (اخزا)';
    if (s.startsWith('گام') || n.includes('اعتبار مولد')) return 'اوراق گام';
    if (['مرابحه', 'اجاره', 'منفعت', 'مشارکت', 'صکوک', 'سلف', 'استصناع', 'رهنی', 'خرید دین'].some(k => n.includes(k))) return 'صکوک و اوراق بدهی';
    if (n.includes('گواهی سپرده') || n.includes('گواهی‌سپرده')) return 'گواهی سپرده کالا';
    if (n.includes('صندوق') || ['طلا', 'عیار', 'کهربا', 'زر', 'گنج', 'مثقال', 'نفیس', 'ناب'].includes(s)) {
      if (['طلا', 'کالا', 'زر', 'سکه'].some(k => n.includes(k))) return 'صندوق طلا و کالا';
      if (n.includes('اهرم')) return 'صندوق اهرمی';
      if (['درآمد ثابت', 'ثابت', 'اندوخته', 'سپر'].some(k => n.includes(k))) return 'صندوق درآمد ثابت';
      return 'صندوق سهامی/مختلط';
    }
    if (s.endsWith('ح') && s.length > 2) return 'حق تقدم';
    return 'سهام';
  };

  /** دیده‌بان همه نمادها + فیلدهای مشتق (تغییر٪، قدرت خریدار، پول حقیقی، صف خرید/فروش) */
  T.marketWatch = async () => {
    let rows = [], src = '';
    for (const [fn, name] of [[watchOld, 'old.tsetmc'], [watchCdn, 'cdn.tsetmc']]) {
      try { rows = await fn(); if (rows.length) { src = name; break; } } catch (e) { console.warn(`دیده‌بان از ${name} ناموفق: ${e.message}`); }
    }
    if (!rows.length) throw new Error('دیده‌بان بازار در دسترس نیست');
    try {
      const ct = await clientAll();
      rows.forEach(r => Object.assign(r, ct[r.ins_code] || {}));
    } catch (e) { console.warn('حقیقی/حقوقی کل بازار ناموفق:', e.message); }
    return T.enrich(rows, src);
  };

  T.enrich = (rows, src = '') => {
    const nz = x => (x === 0 || x == null || Number.isNaN(+x)) ? null : +x;
    const N = x => (x == null || Number.isNaN(+x)) ? null : +x;
    const ratio = (a, b) => (nz(b) == null || N(a) == null) ? null : a / b;
    return rows.map(r => {
      for (const k of ['open', 'close', 'last', 'count', 'volume', 'value', 'low', 'high', 'yesterday', 'base_volume', 'range_max', 'range_min', 'shares', 'eps'])
        r[k] = N(r[k]);
      r.source = src;
      r.category = T.classify(r.symbol, r.name);
      r.market = r.flow != null ? (FLOW[+r.flow] || String(r.flow)) : '';
      const y = nz(r.yesterday);
      r.chg_last = y && r.last != null ? (r.last / y - 1) * 100 : null;
      r.chg_close = y && r.close != null ? (r.close / y - 1) * 100 : null;
      r.pe = r.eps > 0 && r.close != null ? r.close / r.eps : null;
      if (r.r_buy_v != null) {
        const bpc = ratio(r.r_buy_v, r.r_buy_n), spc = ratio(r.r_sell_v, r.r_sell_n);
        const bp = bpc != null && nz(spc) ? bpc / spc : null;
        r.buyer_power = bp != null && isFinite(bp) ? bp : null;
        r.real_flow_bn_toman = (r.r_buy_v - r.r_sell_v) * (r.close || 0) / 1e10;
      }
      r.vol_ratio = ratio(r.volume, r.base_volume);
      r.buy_queue = r.last != null && r.last >= r.range_max && (r.ask_vol || 0) === 0 && r.range_max > 0;
      r.sell_queue = r.last != null && r.last <= r.range_min && (r.bid_vol || 0) === 0 && r.range_min > 0;
      return r;
    });
  };

  // ---------------------------------------------------------------- شاخص‌ها
  T.indices = async () => {
    const rows = []; let err;
    for (const [path, kind] of [['/Index/GetIndexB1LastAll/SelectedIndexes/1', 'منتخب'], ['/Index/GetIndexB1LastAll/All/1', 'صنعت']]) {
      try {
        for (const it of (await T.get(path)).indexB1 || [])
          rows.push({ kind, ins_code: String(it.insCode), name: U.normalize(it.lVal30), value: it.xDrNivJIdx004, change: it.indexChange,
            chg_pct: it.xVarIdxJRfV, high: it.xPhNivJIdx004, low: it.xPbNivJIdx004 });
      } catch (e) { err = e; console.warn(e.message); }
    }
    if (!rows.length && err) throw err;
    const seen = new Set();
    return rows.filter(r => !seen.has(r.ins_code) && seen.add(r.ins_code));
  };

  // ---------------------------------------------------------------- اوراق
  T.bondTable = (mw, today, bench) => {
    const out = [];
    for (const r of mw.filter(x => x.category === 'اسناد خزانه (اخزا)' || x.category === 'اوراق گام')) {
      const price = r.close > 0 ? r.close : r.last;
      if (!price || price <= 0) continue;
      let mat = null, note = '';
      try {
        if (r.category === 'اسناد خزانه (اخزا)') {
          const m = r.name.match(/(\d{2})(\d{2})(\d{2})\s*$/);
          if (m) mat = U.jalaliToGregorian(`14${m[1]}/${m[2]}/${m[3]}`);
        } else {
          const m = r.symbol.match(/(\d{2})(\d{2})$/);
          if (m) {
            const yy = +m[1], mm = +m[2];
            if (mm >= 1 && mm <= 12) {
              mat = U.jalaliToGregorian(`14${String(yy).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${mm === 12 ? 29 : mm > 6 ? 30 : 31}`);
              note = 'سررسید تخمینی (پایان ماه)';
            }
          }
        }
      } catch (e) { mat = null; }
      const face = 1e6;
      const row = { symbol: r.symbol, category: r.category, name: r.name, price, value_bn: (r.value || 0) / 1e10, maturity: mat, note };
      if (mat && price >= 0.3 * face && price <= 1.05 * face) {
        const days = U.daysBetween(today, mat);
        if (days > 0) { row.days = days; row.ytm = ((face / price) ** (365 / days) - 1) * 100; }
      }
      out.push(row);
    }
    if (!out.length || !out.some(r => r.ytm != null)) return out;
    let ref = U.median(out.filter(r => r.category === 'اسناد خزانه (اخزا)' && r.days >= 30).map(r => r.ytm));
    if (bench && Number.isNaN(ref)) ref = bench * 100;
    out.forEach(r => { r.vs_market = r.ytm != null && !Number.isNaN(ref) ? r.ytm - ref : null; });
    out.sort((a, b) => (b.ytm ?? -1e9) - (a.ytm ?? -1e9));
    out.benchmark = Number.isNaN(ref) ? null : ref;
    return out;
  };

  // ---------------------------------------------------------------- غربالگری
  T.screen = mw => {
    const st = mw.filter(r => (r.category === 'سهام' || r.category === 'حق تقدم') && r.value > 0);
    const res = {
      'بیشترین رشد': U.nlargest(st, 'chg_close', 15),
      'بیشترین افت': U.nsmallest(st, 'chg_close', 15),
      'بیشترین ارزش معاملات': U.nlargest(st, 'value', 15),
      'صف خرید': st.filter(r => r.buy_queue).slice(0, 30),
      'صف فروش': st.filter(r => r.sell_queue).slice(0, 30),
      'حجم مشکوک (بیش از ۲ برابر حجم مبنا)': U.nlargest(st.filter(r => r.vol_ratio > 2), 'vol_ratio', 20),
    };
    if (st.some(r => r.real_flow_bn_toman != null)) {
      res['ورود پول حقیقی'] = U.nlargest(st, 'real_flow_bn_toman', 15);
      res['خروج پول حقیقی'] = U.nsmallest(st, 'real_flow_bn_toman', 15);
      res['قدرت خریدار بالا بدون رشد زیاد قیمت (فرصت احتمالی)'] = U.nlargest(
        st.filter(r => r.buyer_power >= 2 && r.real_flow_bn_toman > 0 && r.chg_close < 4), 'buyer_power', 20);
    }
    return res;
  };

  T.marketBreadth = mw => {
    const st = mw.filter(r => r.category === 'سهام' && r.value > 0);
    const out = { positive: st.filter(r => r.chg_close > 0).length, negative: st.filter(r => r.chg_close < 0).length,
      buy_queues: st.filter(r => r.buy_queue).length, sell_queues: st.filter(r => r.sell_queue).length,
      total_value_bn_toman: Math.round(mw.reduce((s, r) => s + (r.value || 0), 0) / 1e10) };
    if (st.some(r => r.real_flow_bn_toman != null))
      out.real_flow_bn_toman = Math.round(st.reduce((s, r) => s + (r.real_flow_bn_toman || 0), 0));
    out.by_category = {};
    for (const r of mw) {
      const c = out.by_category[r.category] || (out.by_category[r.category] = { count: 0, value_bn_toman: 0 });
      c.count++; c.value_bn_toman += (r.value || 0) / 1e10;
    }
    for (const c of Object.values(out.by_category)) c.value_bn_toman = U.round(c.value_bn_toman, 1);
    return out;
  };

  IM.Tsetmc = T;
})(window.IM = window.IM || {});
