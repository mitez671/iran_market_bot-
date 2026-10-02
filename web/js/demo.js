/* حالت دمو: داده ساختگی و بدون اینترنت. روی توابع منابع موقتاً جایگزین می‌شود و بعد از اجرا برمی‌گردد.
   در دمو داده‌ی واقعی (ns=im) خراب نمی‌شود چون Store با ns جدا کار می‌کند. */
(function (IM) {
  const { U } = IM;
  const Demo = { _saved: null };

  function rng(seed) { // mulberry32
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const normal = r => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  function bdays(n, endIso) {
    const out = []; let d = endIso;
    while (out.length < n) { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); if (dow !== 5 && dow !== 4) out.push(d); d = U.addDays(d, -1); }
    return out.reverse();
  }

  Demo.install = () => {
    if (Demo._saved) return;
    const { Src, Tsetmc: T } = IM, r = rng(7), today = U.tehranNow().date;
    Demo._saved = { src: { ...Src }, t: { ...T } };

    const fakeHist = (_c, n = 250) => {
      n = Math.min(n, 250); let p = 10000; const dates = bdays(n, today);
      return dates.map((date, i) => { const prev = p; p *= Math.exp(0.001 + 0.025 * normal(r));
        return { date, open: p * 0.99, high: p * 1.02, low: p * 0.98, close: p, last: p, yesterday: i ? prev : p, volume: Math.floor(1e6 + r() * 8e6), value: p * 5e6, count: Math.floor(500 + r() * 2500) }; });
    };
    T.resolve = async s => ({ ins_code: '1', symbol: U.normalize(s), name: s.startsWith('ض') ? 'اختیارخ اهرم-24000-1405/09/15' : s });
    T.history = async (c, n) => fakeHist(c, n);
    T.clientType = async () => bdays(30, today).map(date => ({ date, buy_I_Volume: 2e6 + r() * 6e6, sell_I_Volume: 2e6 + r() * 6e6,
      buy_CountI: 200 + r() * 700, sell_CountI: 200 + r() * 700, buy_N_Volume: 0, sell_N_Volume: 0 }));
    T.marketOverview = async () => ({ bourse: { index: 3100000, index_change: 12000 }, farabourse: { index: 21000, index_change: -40 } });
    T.indices = async () => [{ kind: 'منتخب', ins_code: '1', name: 'شاخص کل', value: 3100000, change: 12000, chg_pct: 0.4 },
      { kind: 'صنعت', ins_code: '2', name: 'فلزات اساسی', value: 900000, change: -3000, chg_pct: -0.3 }];
    T.marketWatch = async () => {
      const items = [['فولاد', 'فولاد مبارکه اصفهان'], ['فملی', 'ملی صنایع مس ایران'], ['خودرو', 'ایران خودرو'], ['شپنا', 'پالایش نفت اصفهان'], ['وبملت', 'بانک ملت'],
        ['کگل', 'معدنی و صنعتی گل گهر'], ['عیار', 'صندوق طلای عیار مفید'], ['اهرم', 'صندوق س سهامی کاریزما- اهرمی'],
        ['اخزا204', 'اسنادخزانه-م4بودجه02-060320'], ['اخزا406', 'اسنادخزانه-م6بودجه04-051220'], ['اخزا510', 'اسنادخزانه-م10بودجه05-060901'],
        ['گام0602', 'گواهی اعتبار مولد رفاه0602'], ['صکوک', 'مرابحه عام دولت4-ش.خ0507'], ['ضهرم5009', 'اختیارخ اهرم-24000-1405/09/15']];
      const rows = items.map(([symbol, name], i) => {
        const bond = /^(اسناد|گواهی|مرابحه)/.test(name);
        const y = bond ? (i % 2 ? 880000 : 930000) : Math.floor(1000 + r() * 29000), c = y * (1 + (r() - 0.5) * 0.1);
        return { ins_code: symbol, symbol, name, open: y, close: c, last: c, count: 100, volume: 1e6, value: c * 1e6, low: y * .95, high: y * 1.05, yesterday: y, eps: 500,
          base_volume: 4e5, flow: 1, group: '27', range_max: y * 1.05, range_min: y * .95, shares: 1e9, r_buy_n: 300, r_buy_v: 6e5, r_sell_n: 900, r_sell_v: 5e5 };
      });
      // اختیار نمونه: قیمت اعمال کمی بالاتر از سهم پایه و پرمیوم واقع‌بینانه (برای جدول کاورد کال)
      const base = rows.find(x => x.symbol === 'اهرم'), opt = rows.find(x => x.symbol === 'ضهرم5009');
      const k = Math.round(base.close * 1.05);
      opt.name = `اختیارخ اهرم-${k}-1405/09/15`;
      opt.last = opt.close = opt.yesterday = base.close * 0.06;
      rows.forEach(x => { x.bid = x.close * 0.995; x.ask = x.close * 1.005; });
      return T.enrich(rows, 'demo');
    };
    Src.tgjuCur = { price_dollar_rl: { p: '1,100,000', dp: '0.8' }, price_eur: { p: '1,290,000', dp: '0.2' }, sekee: { p: '1,230,000,000', dp: '1.1' }, nim: { p: '650,000,000', dp: '0.9' },
      rob: { p: '380,000,000', dp: '0.7' }, geram18: { p: '105,000,000', dp: '0.5' }, mesghal: { p: '455,000,000', dp: '0.5' }, ons: { p: '3,900', dp: '0.4' },
      oil_brent: { p: '68.2', dp: '-1.2' }, 'crypto-bitcoin': { p: '98000', dp: '1.5' } };
    Src.fetchTgju = async () => ({ ounce: { price: 3900, change_pct: 0.4 }, usd_irr: { price: 1100000, change_pct: 0.8 }, coin_emami: { price: 1230000000, change_pct: 1.1 },
      coin_half: { price: 650000000, change_pct: 0.9 }, coin_quarter: { price: 380000000, change_pct: 0.7 }, gold_18k: { price: 105000000, change_pct: 0.5 } });
    const fakeSeries = (p0, drift) => Array.from({ length: 400 }, (_, i) => [U.addDays(today, i - 400), p0 * Math.exp(drift * i / 400 + 0.03 * normal(r))]);
    T.indexHistories = async () => ({ series: { tedpix: fakeSeries(2.4e6, 0.25), tedpix_eq: fakeSeries(7e5, 0.2), ifx: fakeSeries(17000, 0.2) }, msg: 'دمو' });
    Src.fetchTgjuHistory = async () => ({ series: { usd_irr: fakeSeries(7e5, 0.45), gold_18k: fakeSeries(6e7, 0.5), coin_emami: fakeSeries(7e8, 0.55) }, msg: 'دمو' });
    T.fundNavs = async mw => ({ navs: Object.fromEntries(mw.filter(x => T.FUND_CATS.includes(x.category)).map((x, i) => [x.ins_code, { cancel: x.close / (1 + [0.06, -0.02, 0.15][i % 3]), issue: null, date: today }])), msg: 'دمو' });
    Src.fetchGlobal = async tk => Object.fromEntries(Object.keys(tk).map(k => [k, fakeHist(null, 130)]));
    Src.fetchSite = async site => [
      { title: 'تشدید تحریم‌ها و جهش دلار در بازار آزاد', source: site.name, link: '#' },
      { title: 'کاهش نرخ سود بانکی و ورود پول حقیقی به بورس؛ فولاد مبارکه صف خرید شد', source: site.name, link: '#' },
      { title: 'افزایش قیمت خودرو در بازار', source: site.name, link: '#' }];
    Src.codalLatest = async () => [{ symbol: 'فولاد', company: 'فولاد', title: 'گزارش فعالیت ماهانه', time: '1405/07/09', link: '#' }];
    Src.imeTrades = async () => [{ date: '1405/07/08', kala: 'میلگرد A3 ذوب آهن', producer: 'ذوب آهن', base_price: 300000, price: 330000, max_price: 335000, volume: 2000, value: 6.6e11, group: 'فولاد', premium_pct: 10 }];
    Src.scrapeTables = async src => (src.category === 'خودرو'
      ? [{ category: 'خودرو', item: 'پژو ۲۰۷', price: 1150000000, detail: 'بازار', source: src.name }]
      : [{ category: 'آهن‌آلات', item: 'میلگرد ۱۲', price: 33000, detail: 'کیلو', source: src.name }]);
  };

  Demo.uninstall = () => {
    if (!Demo._saved) return;
    Object.assign(IM.Src, Demo._saved.src); Object.assign(IM.Tsetmc, Demo._saved.t); Demo._saved = null;
  };

  /** تنظیمات دمو: روی کپی تنظیمات اعمال می‌شود */
  Demo.config = cfg => {
    const c = JSON.parse(JSON.stringify(cfg));
    c.watchlist.options = ['ضهرم5009']; c.use_yahoo = true; c.llm = { mode: 'manual' };
    c.notify = { only_on_change: true }; c.source_modes = {};
    c.loans = { ...(c.loans || {}), sources: [], rade: { enabled: false } };          // دمو به سایت بانک‌ها درخواست نمی‌فرستد
    c.news.sites = [{ name: 'دمو', url: 'https://demo.test/' }];
    c.other_markets = [{ category: 'خودرو', name: 'همراه مکانیک', url: 'https://demo.test/a' }, { category: 'آهن‌آلات', name: 'آهن‌آنلاین میلگرد', url: 'https://demo.test/b' }];
    return c;
  };
  IM.Demo = Demo;
})(window.IM = window.IM || {});
