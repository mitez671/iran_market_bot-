/* یک چرخه کامل (معادل run_cycle در main.py) + ساخت جدول‌های داشبورد. بدون وابستگی به DOM. */
(function (IM) {
  const { U, Net, Store, Engine: E, NLP, Out, Finance: F } = IM;
  const C = {};

  // ---------------------------------------------------------------- جدول
  const clean = v => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };
  C.table = (rows, cols, limit) => {
    if (!rows || !rows.length) return { cols: [], rows: [] };
    const present = new Set(); rows.forEach(r => Object.keys(r).forEach(k => { if (r[k] !== undefined) present.add(k); }));
    const keys = cols ? Object.keys(cols).filter(k => present.has(k)) : [...present];
    const labels = keys.map(k => [k, cols ? cols[k] : k]);
    return { cols: labels, rows: (limit ? rows.slice(0, limit) : rows).map(r => keys.map(k => clean(r[k]))) };
  };

  C.inMarketHours = (cfg, now = U.tehranNow()) => {
    const mh = cfg.market_hours;
    return mh.days.includes(now.dow) && mh.start <= now.hm && now.hm <= mh.end;
  };

  // ---------------------------------------------------------------- تحلیل (فقط از bundle می‌خواند؛ بدون درخواست شبکه)
  const ago = (t, now) => {
    if (!t) return '';
    const m = Math.round((Date.parse(now + ':00Z') - Date.parse(t + ':00Z')) / 60000);
    return m < 1 ? 'همین الان' : m < 90 ? `${m} دقیقه پیش` : m < 2880 ? `${Math.round(m / 60)} ساعت پیش` : `${Math.round(m / 1440)} روز پیش`;
  };

  /** حداکثر ۸ تیتر از هر کشور/منطقه (تا اخبار یک منبع پرتعداد همه‌چیز را نگیرد) و سقف ۸۰ تیتر؛ اخبار دارای اثر اقتصادی اول */
  const balancedNews = news => {
    const by = {}, out = [];
    [...news].sort((a, b) => (b.impact || []).some(x => x) - (a.impact || []).some(x => x)).forEach(n => {
      const r = n.region || 'ایران';
      if ((by[r] = (by[r] || 0) + 1) <= 8 && out.length < 80) out.push(n);
    });
    return out;
  };

  /** hooks: {step(i, title)} با i از ۱ تا ۳. خروجی: نتیجه کامل برای رندر داشبورد */
  C.analyze = async (cfg, bundle, hooks = {}) => {
    const step = hooks.step || (() => {});
    const { Src, Tsetmc: T, Collect: K } = IM;
    const now = U.tehranNow(), today = now.date;
    const sc = cfg.signals, wl = cfg.watchlist;
    const warn = console.warn;
    const data = id => { const b = bundle.sources[id]; return b && b.data; };

    // وضعیت منابع از روی bundle (کیفیت و تازگی هر داده)
    const status = {};
    for (const s of K.list(cfg)) {
      const mode = K.modeOf(cfg, s.id);
      if (mode === 'off') continue;
      const b = bundle.sources[s.id];
      status[s.label] = !b ? '⚪ دریافت نشده'
        : b.ok ? `✅ ${b.msg} — ${ago(b.t, now.iso)}`
          : `❌ ${b.msg}` + (b.data ? ` (داده‌ی قدیمی‌تر از ${ago(b.t, now.iso)} استفاده شد)` : '');
    }
    const off = id => K.modeOf(cfg, id) === 'off';
    const use = id => (off(id) ? null : data(id));

    // ---- ۱) آماده‌سازی داده‌ها از bundle
    step(1, 'آماده‌سازی داده‌های جمع‌شده…');
    const tg = use('tgju') || { local: {}, cur: {} };
    const local = tg.local || {};
    Src.tgjuCur = tg.cur || {};
    const tgjuRows = Src.tgjuAll(Src.tgjuCur);
    const mw = use('tsetmc_watch') || [];
    const ix = use('tsetmc_index') || {}, idx = ix.idx || [], overview = ix.overview || {};
    const codal = use('codal') || [], ime = use('ime') || [];
    const news = Src.mergeNews((cfg.news.sites || []).map(s => use('news:' + s.name) || []));
    const other = [].concat(...(cfg.other_markets || []).map(s => use('other:' + s.name) || []));
    const glob = E.globalSummary((cfg.use_yahoo && use('global')) || {});
    for (const [name, v] of Object.entries(Src.tgjuGlobal())) {
      if (glob[name]) continue;
      glob[name] = { last: v.price, chg_1d: v.change_pct, chg_5d: Store.changePct(name, v.price, 7, today), chg_20d: Store.changePct(name, v.price, 28, today),
        trend: 'نامشخص', rsi: null, source: `tgju:${v.key}` };
    }
    if (!local.ounce && glob.gold_ounce) local.ounce = { price: glob.gold_ounce.last, change_pct: glob.gold_ounce.chg_1d };
    const usdChg = (local.usd_irr || {}).change_pct;
    const implied = F.impliedUsd(Src.tgjuCur);
    const breadth = mw.length ? T.marketBreadth(mw) : {};
    const screens = mw.length ? T.screen(mw) : {};
    const imeSum = Src.imeSummary(ime);

    // ---- ۲) تحلیل اخبار
    step(2, 'تحلیل هوشمند اخبار…');
    const names = {};
    mw.forEach(r => { if (r.symbol && r.symbol.length >= 3) names[r.symbol] = r.name; });
    let nlp = { impact: {}, themes: {}, by_symbol: {} };
    try { nlp = NLP.analyze(news, names, today); status['تحلیل اخبار'] = `✅ ${nlp.n_relevant} خبر اثرگذار`; }
    catch (e) { status['تحلیل اخبار'] = `❌ ${e.message}`; warn(e.message); }
    const newsScore = (nlp.impact || {})['بورس'] || 0;

    const prices = {};
    Object.entries(glob).forEach(([k, v]) => { prices[k] = v.last; });
    Object.entries(local).forEach(([k, v]) => { prices[k] = v.price; });
    prices.tether = U.toNum((Src.tgjuCur['crypto-tether-irr'] || {}).p);
    prices.tedpix = (overview.bourse || {}).index; prices.ifx = (overview.farabourse || {}).index;
    Store.savePrices(prices, today);
    for (const id of ['tsetmc_index_hist', 'tgju_hist']) { const h = use(id); if (h && h.series) Store.backfillPrices(h.series, today); }

    // ---- ۳) سیگنال‌ها و گزارش
    step(3, 'سیگنال‌ها، تحلیل Claude و داشبورد…');
    const signals = [], sd = use('tsetmc_symbols') || { stocks: {}, options: {} };
    for (const [market, syms] of [['سهام', wl.stocks || []], ['صندوق', wl.funds || []]]) {
      for (const sym of syms) {
        const e = sd.stocks[U.normalize(sym)];
        if (!e) continue;
        const inter = E.intermarketScore(U.normalize(sym), cfg.sensitivity || {}, glob, usdChg);
        const sig = E.stockSignal(sym, market, e.hist, e.ct, inter, newsScore, sc.min_score);
        ((nlp.by_symbol || {})[U.normalize(sym)] || []).slice(0, 2).forEach(h => sig.reasons.push(`خبر: ${h.slice(0, 70)}`));
        signals.push(sig);
      }
    }
    // اوراق: اخزا و گام از دیده‌بان کامل
    const bonds = mw.length ? T.bondTable(mw, today) : [];
    const bench = bonds.benchmark;
    const eq = F.equityPremium(mw, bench ?? null);
    const erpHist = Store._series('erp').filter(([d]) => d < today);
    if (eq.market.ep != null) Store.savePrices({ erp: eq.market.erp, market_pe: eq.market.pe }, today);
    const eqNote = F.premiumNote(eq.market, erpHist);
    const fb = F.fundBubbles(mw, use('tsetmc_nav')), fbAlert = (cfg.fund_bubble || {}).alert_pct ?? 3, fbNote = F.bubbleNote(fb, fbAlert);
    const infBasis = F.inflationBasis(cfg.inflation), realNote = F.realNote(bench ?? null, infBasis);
    const realYtm = infBasis && bench != null ? F.realRate(bench, infBasis.v) : null;
    const ccCfg = cfg.covered_call || {};
    const cc = F.coveredCalls(mw, today, bench ?? null, ccCfg), ccNote = F.coveredNote(cc, bench ?? null, ccCfg.min_protection_pct ?? 5);
    // تابلوی «پول کجا برود»
    const PAST = [['usd_irr', 'دلار آزاد'], ['eur_irr', 'یورو'], ['tether', 'تتر'], ['gold_18k', 'طلای ۱۸ عیار'], ['mesghal', 'مثقال طلا'], ['coin_emami', 'سکه امامی'],
      ['tedpix', 'شاخص کل بورس'], ['tedpix_eq', 'شاخص کل هم‌وزن'], ['ifx', 'شاخص فرابورس'], ['gold_ounce', 'انس جهانی طلا ($)'], ['bitcoin', 'بیت‌کوین ($)']];
    const past = PAST.map(([k, name]) => { const last = prices[k] || Store.lastPrice(k);
      return { name, last, d30: last ? Store.changePct(k, last, 30, today, 45) : null, d90: last ? Store.changePct(k, last, 90, today, 120) : null, d365: last ? Store.changePct(k, last, 365, today, 430) : null }; });
    const loanAlt = typeof (cfg.loans || {}).alt_rate === 'number' ? cfg.loans.alt_rate : bench ?? (typeof cfg.benchmark_rate === 'number' ? cfg.benchmark_rate * 100 : 35);
    const infP2p = (F.inflationBasis({ ...(cfg.inflation || {}), basis: 'p2p' }) || {}).v ?? null;
    const where = F.whereMoney({ ytm: bench ?? null, deposit: (cfg.inflation || {}).deposit_rate ?? null, cc, ccMinProt: ccCfg.min_protection_pct ?? 5, eq,
      loans: ((cfg.loans || {}).plans || []).map(p => ({ name: `${p.bank || ''} ${p.name || ''}`.trim(), eff: F.loanCalc(p, loanAlt).eff })),
      inf: infBasis, past, past12Inf: infP2p });
    const whereNote = F.whereNote(where, infBasis);
    const benchRate = typeof cfg.benchmark_rate === 'number' ? cfg.benchmark_rate : (cfg.benchmark_rate === 'auto' && bench ? bench / 100 : 0.35);
    const margin = (cfg.bond_margin ?? 0.015) * 100;
    for (const b of bonds) {
      if (b.vs_market == null || b.days < 20 || Math.abs(b.vs_market) < margin || b.note) continue;
      const act = b.vs_market > 0 ? 'BUY' : 'SELL';
      signals.push(E.Signal(b.symbol, b.category, act, U.round(b.vs_market, 1), b.price,
        [`بازده تا سررسید ${b.ytm.toFixed(1)}٪ (${b.days} روز)`,
          `${act === 'BUY' ? 'ارزان‌تر' : 'گران‌تر'} از میانه بازار (${bench.toFixed(1)}٪) به اندازه ${b.vs_market >= 0 ? '+' : ''}${b.vs_market.toFixed(1)}٪`],
        { ytm: U.round(b.ytm, 2) }));
    }
    for (const [osym, o] of Object.entries(sd.options || {}))
      signals.push(E.optionSignal(osym, o.opt, +U.last(o.prem).last, o.base, U.jalaliToGregorian(o.opt.expiry_jalali), today, benchRate));
    signals.push(...E.goldSignals(local, sc.coin_bubble_sell, sc.coin_bubble_buy));
    const nb = { overall: newsScore, by_tag: { 'سیاست/تحریم': -((nlp.impact || {})['دلار'] || 0) } };
    const narrative = E.macroNarrative(glob, local, nb);

    const snapshot = {
      time_tehran: now.iso, index: overview, breadth,
      sector_indices_top: U.nlargest(idx, 'chg_pct', 8).map(r => ({ name: r.name, chg_pct: r.chg_pct })),
      bond_market_median_ytm: bench,
      equity_premium: eq.market.ep != null ? { pe: U.round(eq.market.pe, 1), ep_pct: U.round(eq.market.ep, 1), ytm_pct: bench == null ? null : U.round(bench, 1),
        erp_pct: eq.market.erp == null ? null : U.round(eq.market.erp, 1), required_earnings_growth_pct: eq.market.req_growth == null ? null : U.round(eq.market.req_growth, 1),
        cheapest_sectors_by_ep: eq.sectors.filter(x => x.count >= 3).sort((a, b) => b.ep - a.ep).slice(0, 5).map(x => ({ sector: x.sector, pe: U.round(x.pe, 1), ep_pct: U.round(x.ep, 1) })) } : null,
      where_money: { forward: where.fwd.map(x => ({ option: x.name, nominal_pct: U.round(x.nominal, 1), real_pct: x.real == null ? null : U.round(x.real, 1), risk: x.risk })),
        past_returns: where.past.map(p => ({ asset: p.name, d30_pct: p.d30 == null ? null : U.round(p.d30, 1), d90_pct: p.d90 == null ? null : U.round(p.d90, 1), d365_pct: p.d365 == null ? null : U.round(p.d365, 1) })) },
      real_rate: infBasis ? { inflation_pct: infBasis.v, inflation_basis: infBasis.label, nominal_ytm_pct: bench == null ? null : U.round(bench, 1),
        real_ytm_pct: realYtm == null ? null : U.round(realYtm, 1) } : null,
      fund_bubbles: fb.length ? { by_category: F.bubbleSummary(fb).map(s => ({ category: s.category, count: s.count, median_pct: U.round(s.median, 1), weighted_pct: s.weighted == null ? null : U.round(s.weighted, 1) })),
        extremes: [...fb.slice(0, 5), ...fb.slice(-5)].map(r => ({ symbol: r.symbol, category: r.category, bubble_pct: U.round(r.bubble, 1) })) } : null,
      covered_calls_top: cc.filter(r => r.live && r.protection >= (ccCfg.min_protection_pct ?? 5) && r.days >= 14).slice(0, 10)
        .map(r => ({ option: r.symbol, underlying: r.underlying, days: r.days, ann_if_flat_pct: U.round(r.ann_flat, 1), ann_if_called_pct: U.round(r.ann_call, 1), protection_pct: U.round(r.protection, 1) })),
      implied_usd: implied.core ? { gold_implied_usd: Math.round(implied.core), market_usd: implied.usd, gap_pct: U.round(implied.gap, 1),
        items: implied.rows.map(r => ({ item: r.item, implied: Math.round(r.implied_usd), gap_pct: U.round(r.gap_pct, 1) })) } : null,
      local_prices: local, global: glob, macro_notes: narrative,
      news_ai: { impact: nlp.impact, nn: nlp.nn, themes: nlp.themes, nn_info: nlp.nn_info },
      top_news: balancedNews(news).map(n => `[${n.region || ''}|${n.source}] ${n.title}`),
      codal: codal.slice(0, 20).map(c => `${c.symbol}: ${c.title}`),
      ime_top: imeSum.slice(0, 10),
      screens: Object.fromEntries(Object.entries(screens).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 5).map(r => ({ symbol: r.symbol, chg_close: r.chg_close }))])),
      signals: signals.map(s => ({ symbol: s.symbol, market: s.market, action: s.action, score: s.score, price: s.price, reasons: s.reasons })),
      data_sources: status,
    };
    const llm = await Out.runLlm(snapshot, cfg.llm || {});
    const view = C.buildView({ cfg, signals, mw, idx, overview, breadth, screens, bonds, local, tgjuRows, glob, news, codal, ime, imeSum, other, nlp, narrative, status, implied, eq, eqNote, cc, ccNote, fb, fbNote, realNote, realYtm, where, whereNote, llmText: llm.text });

    const alerts = (cfg.notify || {}).only_on_change !== false ? Store.changedSignals(signals) : signals.filter(s => s.action !== 'HOLD');
    if (alerts.length) {
      let msg = '📊 سیگنال‌های جدید\n\n' + alerts.slice(0, 15).map(Out.formatAlert).join('\n\n');
      if (llm.text) msg += '\n\n🤖 خلاصه Claude:\n' + llm.text.slice(0, 2500);
      await Out.send(msg, cfg.notify);
    }
    return { view, signals, status, prompt: llm.prompt, llmText: llm.text, llmError: llm.error, alerts: alerts.length, time: now.iso, nSymbols: mw.length };
  };

  /** اجرای مستقیم: همه‌ی منابع غیرغیرفعال را همین الان (با شبکه‌ی فعلی) می‌گیرد و تحلیل می‌کند. */
  C.run = async (cfg, hooks = {}, bundle = { sources: {} }) => {
    const { Collect: K } = IM;
    const ids = K.list(cfg).filter(s => K.modeOf(cfg, s.id) !== 'off').map(s => s.id);
    (hooks.step || (() => {}))(0, 'دریافت داده از منابع…');
    await K.run(cfg, bundle, ids, { progress: hooks.progress });
    const res = await C.analyze(cfg, bundle, hooks);
    res.bundle = bundle;
    return res;
  };

  // ---------------------------------------------------------------- ساخت نمای داشبورد
  C.buildView = ctx => {
    const { signals, mw, idx, overview, breadth, screens, bonds, local, tgjuRows, glob, news, codal, ime, imeSum, other, nlp, narrative, status, implied, eq, eqNote, cc, ccNote, fb, fbNote, realNote, realYtm, where, whereNote, llmText } = ctx;
    const t = {}, T = C.table;
    const ord = { BUY: 0, SELL: 1, HOLD: 2 };
    t.signals = T([...signals].sort((a, b) => ord[a.action] - ord[b.action] || Math.abs(b.score) - Math.abs(a.score)).map(s => ({
      symbol: s.symbol, market: s.market, action: s.fa_action, score: s.score, price: s.price, stop: s.stop, target: s.target, reasons: s.reasons.join(' • ') })),
      { symbol: 'نماد', market: 'بازار', action: 'سیگنال', score: 'امتیاز', price: 'قیمت', stop: 'حد ضرر', target: 'هدف', reasons: 'دلایل' });
    const mwc = { symbol: 'نماد', name: 'نام', category: 'نوع', market: 'بازار', last: 'آخرین', close: 'پایانی', chg_close: 'تغییر٪', value: 'ارزش (ریال)',
      buyer_power: 'قدرت خریدار', real_flow_bn_toman: 'پول حقیقی (میلیارد ت)', vol_ratio: 'حجم/مبنا', pe: 'P/E' };
    const byValue = rows => [...rows].sort((a, b) => (b.value || 0) - (a.value || 0));
    t.mw = T(byValue(mw), mwc);
    const groups = { funds: ['صندوق طلا و کالا', 'صندوق اهرمی', 'صندوق درآمد ثابت', 'صندوق سهامی/مختلط'], derivs: ['اختیار خرید', 'اختیار فروش', 'آتی'], sukuk: ['صکوک و اوراق بدهی', 'گواهی سپرده کالا'] };
    for (const [k, cats] of Object.entries(groups)) t[k] = T(byValue(mw.filter(r => cats.includes(r.category))), mwc);
    t.bonds = T(bonds, { symbol: 'نماد', category: 'نوع', price: 'قیمت', days: 'روز تا سررسید', ytm: 'بازده تا سررسید٪', vs_market: 'اختلاف با میانه٪', maturity: 'سررسید', value_bn: 'ارزش (میلیارد ت)', note: 'توضیح' });
    t.idx = T(idx, { name: 'شاخص', kind: 'نوع', value: 'مقدار', change: 'تغییر', chg_pct: 'تغییر٪' });
    Object.values(screens).forEach((v, i) => { t[`scr${i}`] = T(v, mwc); });
    t.tgju = T(tgjuRows, { group: 'گروه', label: 'عنوان', key: 'کلید', price: 'قیمت', change_pct: 'تغییر٪', high: 'بیشترین', low: 'کمترین', time: 'زمان' });
    t.implied = T((implied || { rows: [] }).rows, { item: 'دارایی', kind: 'نوع', price: 'قیمت (ریال)', implied_usd: 'دلار ضمنی (ریال)', gap_pct: 'اختلاف با دلار آزاد٪' });
    const eqCols = { sector: 'گروه', count: 'تعداد نماد', cap_bn_toman: 'ارزش بازار (میلیارد ت)', pe: 'P/E', median_pe: 'میانه P/E', ep: 'بازده سود E/P٪',
      erp: 'صرف ریسک٪', req_growth: 'رشد سود لازم٪', coverage: 'پوشش EPS٪', loss_makers: 'زیان‌ده' };
    const eqx = eq || { market: {}, sectors: [], stocks: [] };
    t.eq_sectors = T(eqx.sectors, eqCols);
    t.eq_stocks = T(eqx.stocks, { symbol: 'نماد', name: 'نام', sector: 'گروه', close: 'قیمت', eps: 'EPS', pe: 'P/E', ep: 'بازده سود E/P٪', erp: 'اختلاف با اخزا٪', cap_bn_toman: 'ارزش بازار (میلیارد ت)', value_bn_toman: 'ارزش معاملات (میلیارد ت)' });
    t.cc = T(cc || [], { symbol: 'اختیار', underlying: 'سهم پایه', S: 'قیمت سهم', strike: 'قیمت اعمال', C: 'پرمیوم', days: 'روز تا سررسید',
      moneyness: 'فاصله تا اعمال٪', premium_pct: 'پرمیوم/قیمت٪', ann_flat: 'بازده سالانه با قیمت ثابت٪', ann_call: 'بازده سالانه در صورت اعمال٪',
      ret_flat: 'بازده دوره (ثابت)٪', protection: 'حاشیه‌ی امنیت٪', breakeven: 'سربه‌سر', vs_ytm: 'اختلاف با اخزا٪', price_src: 'منبع قیمت', expiry: 'سررسید' });
    t.fb = T(fb || [], { symbol: 'نماد', name: 'نام', category: 'نوع', close: 'قیمت پایانی', last: 'آخرین', nav: 'NAV ابطال', nav_issue: 'NAV صدور',
      bubble: 'حباب (پایانی)٪', bubble_last: 'حباب (آخرین)٪', value_bn_toman: 'ارزش معاملات (میلیارد ت)', nav_date: 'تاریخ NAV' });
    const wh = where || { fwd: [], cost: [], past: [] };
    t.where_fwd = T([...wh.fwd, ...wh.cost], { name: 'گزینه', nominal: 'سالانه اسمی٪', real: 'سالانه واقعی٪', risk: 'ریسک', note: 'توضیح' });
    t.where_past = T(wh.past, { name: 'دارایی', last: 'آخرین قیمت', d30: '۳۰ روز٪', d90: '۹۰ روز٪', d365: '۱۲ ماه٪', real365: '۱۲ ماه واقعی٪ (با تورم نقطه‌به‌نقطه)' });
    t.glob = T(Object.entries(glob).map(([k, v]) => ({ name: k, ...v })), { name: 'دارایی', last: 'آخرین', chg_1d: '۱ روز٪', chg_5d: '۵ روز٪', chg_20d: '۲۰ روز٪', trend: 'روند', source: 'منبع' });
    t.ime_sum = T(imeSum, { kala_short: 'کالا', trades: 'تعداد عرضه', avg_premium: 'رقابت میانگین٪', avg_price: 'قیمت میانگین', value: 'ارزش' });
    t.ime = T(ime, { date: 'تاریخ', group: 'گروه', kala: 'کالا', producer: 'عرضه‌کننده', base_price: 'قیمت پایه', price: 'قیمت معامله', premium_pct: 'رقابت٪', volume: 'حجم', value: 'ارزش' });
    t.other = T(other, { category: 'بازار', item: 'کالا', price: 'قیمت', detail: 'جزئیات', source: 'منبع' });
    const impCols = {}; NLP.ASSETS.forEach(a => { impCols[`impact_${a}`] = a; });
    t.news = T(news.map(n => { const r = { region: n.region || 'ایران', source: n.source, title: n.title, nn_بورس: (n.nn || {})['بورس'], why: (n.why || []).join('، '), symbols: (n.symbols || []).join('، '), link: n.link };
      NLP.ASSETS.forEach((a, i) => { r[`impact_${a}`] = (n.impact || [])[i] || 0; }); return r; }),
      { region: 'کشور/منطقه', source: 'منبع', title: 'تیتر', ...impCols, 'nn_بورس': 'مدل خودآموز (بورس)', why: 'موضوع', symbols: 'نماد', link: 'link' });
    t.codal = T(codal, { symbol: 'نماد', title: 'عنوان اطلاعیه', time: 'زمان', link: 'link' });
    t.status = T(Object.entries(status).map(([k, v]) => ({ src: k, st: v })), { src: 'منبع', st: 'وضعیت' });

    const ov = overview.bourse || {}, sgn = v => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
    const f = (v, d = 0, sign = false) => v == null ? '—' : (sign && v > 0 ? '+' : '') + Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
    const kpis = [['شاخص کل', f(ov.index), ''], ['تغییر شاخص', f(ov.index_change, 0, true), sgn(ov.index_change)],
      ['ارزش معاملات (میلیارد ت)', breadth.total_value_bn_toman != null ? f(breadth.total_value_bn_toman) : '—', ''],
      ['پول حقیقی (میلیارد ت)', f(breadth.real_flow_bn_toman, 0, true), sgn(breadth.real_flow_bn_toman)],
      ['مثبت / منفی', breadth.positive != null ? `${breadth.positive} / ${breadth.negative}` : '—', ''],
      ['صف خرید / فروش', breadth.buy_queues != null ? `${breadth.buy_queues} / ${breadth.sell_queues}` : '—', '']];
    for (const [k, lab] of [['usd_irr', 'دلار آزاد (ریال)'], ['coin_emami', 'سکه امامی'], ['gold_18k', 'طلای ۱۸']]) {
      const v = local[k] || {};
      kpis.push([lab, f(v.price), sgn(v.change_pct)]);
    }
    if (eq && eq.market.ep != null) kpis.push(['P/E بازار', f(eq.market.pe, 1), ''],
      ['صرف ریسک سهام (E/P − اخزا)', eq.market.erp == null ? '—' : `${f(eq.market.erp, 1, true)}٪`, sgn(eq.market.erp)]);
    const goldFb = (fb || []).filter(r => r.category === 'صندوق طلا و کالا');
    if (goldFb.length) kpis.push(['میانه حباب صندوق‌های طلا', `${f(U.median(goldFb.map(r => r.bubble)), 1, true)}٪`, '']);
    if (implied && implied.core) kpis.push(['دلار ضمنی طلا (ریال)', `${f(implied.core)} (${f(implied.gap, 1, true)}٪)`, sgn(implied.gap)]);
    if (bonds.benchmark) kpis.push(['بازده میانه اخزا', `${bonds.benchmark.toFixed(1)}٪`, '']);
    if (realYtm != null) kpis.push(['بازده واقعی اخزا', `${f(realYtm, 1, true)}٪`, sgn(realYtm)]);

    const imp = Object.entries(nlp.impact || {});
    const tabs = [
      ['t0', 'خلاصه', [['news', 'اثر اخبار امروز (قواعد اقتصادی + مدل خودآموز)', { impact: imp, themes: Object.entries(nlp.themes || {}).slice(0, 12), info: nlp.nn_info || {} }],
        ['table', 'سیگنال‌ها', 'signals'], ['text', 'اثر بازارهای جهانی و ارز', narrative.join('\n') || '—'],
        ...(llmText ? [['text', 'تحلیل Claude', llmText]] : [])]],
      ['t14', 'پول کجا برود', [['text', 'جمع‌بندی', whereNote || '—'], ['table', 'بازده پیش‌رو (سالانه) و هزینه‌ی وام‌ها', 'where_fwd'], ['table', 'بازده گذشته‌ی دارایی‌ها (از سابقه‌ی داشبورد)', 'where_past']]],
      ['t1', 'فرصت‌های کل بازار', Object.keys(screens).map((k, i) => ['table', k, `scr${i}`])],
      ['t2', 'شاخص‌ها', [['table', 'شاخص‌های منتخب و صنایع', 'idx', 'kind']]],
      ['t13', 'صرف ریسک سهام', [['text', 'سهام در برابر اخزا', eqNote || '—'],
        ['table', 'گروه‌های صنعت — بازده سود و صرف ریسک', 'eq_sectors'],
        ['table', `نمادهای سودده با بازده سود بیشتر از اخزا${eqx.market.ytm != null ? ` (${eqx.market.ytm.toFixed(1)}٪)` : ''}`, 'eq_stocks', 'sector']]],
      ['t3', 'دیده‌بان کامل', [['table', 'همه نمادهای بورس و فرابورس', 'mw', 'category']]],
      ['t4', 'اوراق (اخزا، گام، صکوک)', [['text', 'نرخ بهره‌ی واقعی', realNote || '—'], ['table', 'اخزا و گام — بازده تا سررسید', 'bonds', 'category'], ['table', 'صکوک، مرابحه، اجاره و گواهی سپرده', 'sukuk', 'category']]],
      ['t5', 'صندوق‌ها', [['text', 'حباب صندوق‌ها (قیمت در برابر NAV ابطال)', fbNote || '—'], ['table', 'حباب صندوق‌ها', 'fb', 'category'], ['table', 'صندوق‌های قابل معامله', 'funds', 'category']]],
      ['t6', 'اختیار و آتی', [['text', 'کاورد کال (خرید سهم + فروش اختیار خرید)', ccNote || '—'], ['table', 'کاورد کال — بازده تا سررسید', 'cc', 'underlying'], ['table', 'قراردادهای اختیار و آتی', 'derivs', 'category']]],
      ['t7', 'طلا، سکه، ارز', [['text', 'دلار ضمنی', implied && implied.core ? `${F.impliedNote(implied)}\n` +
          `دلار ضمنی = قیمت داخلی ÷ (انس جهانی ÷ ۳۱٫۱ × گرم طلای خالص). «طلای خام» (۱۸ عیار و مثقال) معیار اصلی است؛ در سکه حباب سکه هم داخلش است و تتر مستقیم مقایسه شده.` : F.impliedNote(implied || {})],
        ['table', 'دلار ضمنی طلا، سکه و تتر', 'implied'], ['table', 'همه قیمت‌های tgju', 'tgju', 'group']]],
      ['t8', 'بورس کالا', [['table', 'خلاصه رقابت کالاها', 'ime_sum'], ['table', 'معاملات بازار فیزیکی', 'ime', 'group']]],
      ['t9', 'خودرو، آهن، مسکن', [['table', 'قیمت‌ها', 'other', 'category']]],
      ['t10', 'بازار جهانی', [['table', 'کالاها، ارز و رمزارز جهانی', 'glob']]],
      ['t11', 'اخبار', [['table', 'تیترهای اقتصادی و منطقه‌ای با تحلیل اثر', 'news', 'region'], ['table', 'اطلاعیه‌های کدال', 'codal']]],
      ['t12', 'وضعیت منابع', [['table', 'منابع داده در این اجرا', 'status']]],
    ];
    return { kpis, tabs, tables: t };
  };

  IM.Cycle = C;
})(window.IM = window.IM || {});
