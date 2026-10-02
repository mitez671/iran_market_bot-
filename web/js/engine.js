/* اندیکاتورها و موتور سیگنال: سهام/صندوق، اختیار معامله، سکه و طلا، اثر بازارهای جهانی. */
(function (IM) {
  const { U } = IM;
  const E = {};
  const TRADING_DAYS = 240;   // تقریب روزهای معاملاتی سال در بورس تهران
  const FA_ACTION = { BUY: '🟢 خرید', SELL: '🔴 فروش', HOLD: '⚪ نگهداری/صبر' };

  E.Signal = (symbol, market, action, score, price = null, reasons = [], extra = {}) =>
    ({ symbol, market, action, score, price, reasons, stop: null, target: null, extra, fa_action: FA_ACTION[action] });
  const decide = (score, min) => score >= min ? 'BUY' : score <= -min ? 'SELL' : 'HOLD';
  const fin = x => x != null && Number.isFinite(x);

  // ============================================================ بازار جهانی و اثر بین‌بازاری
  E.globalSummary = gl => {
    const out = {};
    for (const [name, rows] of Object.entries(gl)) {
      const c = rows.map(r => r.close);
      if (c.length < 25) continue;
      const ma50 = c.length >= 50 ? U.rollMean(c, 50) : NaN, last = U.last(c);
      out[name] = { last, chg_1d: U.pct(c, 1), chg_5d: U.pct(c, 5), chg_20d: U.pct(c, 20),
        trend: !Number.isNaN(ma50) ? (last > ma50 ? 'صعودی' : 'نزولی') : 'نامشخص', rsi: U.rsi(c) };
    }
    return out;
  };

  E.intermarketScore = (symbol, sens, glob, usdChg) => {
    const weights = sens[symbol] || {};
    let score = 0; const reasons = [];
    for (const [factor, w] of Object.entries(weights)) {
      let ch, label;
      if (factor === 'usd_irr') { ch = usdChg; label = 'دلار آزاد'; }
      else { const g = glob[factor] || {}; ch = g.chg_5d != null ? g.chg_5d : g.chg_1d; label = factor; }
      if (ch == null) continue;
      const contrib = Math.max(-2, Math.min(2, w * ch / 3));   // هر ۳٪ تغییر هفتگی ≈ ۱ امتیاز (حداکثر ±۲)
      if (Math.abs(contrib) >= 0.3) {
        score += contrib;
        reasons.push(`${label} ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}٪ → اثر ${contrib > 0 ? 'مثبت' : 'منفی'} (${contrib >= 0 ? '+' : ''}${contrib.toFixed(1)})`);
      }
    }
    return [score, reasons];
  };

  E.macroNarrative = (glob, local, nb) => {
    const lines = [], sg = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    const g = (k, f = 'chg_5d') => { const d = glob[k] || {}; return d[f] != null ? d[f] : d.chg_1d; };
    if (g('brent') != null) lines.push(`برنت در ۵ روز ${sg(g('brent'))}٪: ` + (g('brent') > 0
      ? 'مثبت برای پالایشی‌ها و پتروشیمی‌ها (شپنا، شبندر، پتروشیمی‌ها) و درآمد ارزی دولت.'
      : 'فشار بر پالایشی/پتروشیمی و احتمال کسری بودجه → ریسک تورم و رشد دلار در میان‌مدت.'));
    if (g('gold_ounce') != null) lines.push(`انس طلا در ۵ روز ${sg(g('gold_ounce'))}٪: مستقیماً روی سکه، طلای ۱۸ و صندوق‌های طلا اثر دارد.`);
    if (g('copper') != null) lines.push(`مس جهانی ${sg(g('copper'))}٪: اثر مستقیم بر فملی و گروه مس.`);
    if (g('dxy') != null) lines.push(`شاخص دلار (DXY) ${sg(g('dxy'))}٪: ` + (g('dxy') > 0 ? 'دلار قوی جهانی معمولاً به ضرر کامودیتی‌هاست.' : 'دلار ضعیف جهانی معمولاً به نفع کامودیتی‌ها و طلاست.'));
    if (g('bitcoin') != null) lines.push(`بیت‌کوین ${sg(g('bitcoin'))}٪ (۵ روز): شاخص ریسک‌پذیری جهانی و رقیب سرمایه‌گذاری برای بخشی از پول خرد داخلی.`);
    const usd = local.usd_irr || {};
    if (usd.change_pct != null) lines.push(`دلار آزاد امروز ${usd.change_pct >= 0 ? '+' : ''}${usd.change_pct.toFixed(2)}٪: رشد دلار به نفع صادرات‌محورها (فلزی، پتروشیمی) و طلا؛ به ضرر واردات‌محورها.`);
    const v = (nb.by_tag || {})['سیاست/تحریم'];
    if (v != null) lines.push(`فضای خبری سیاسی/تحریم: ${v > 0 ? 'مثبت' : v < 0 ? 'منفی' : 'خنثی'} (${v >= 0 ? '+' : ''}${v.toFixed(2)}) — اخبار منفی معمولاً دلار و طلا را بالا و شاخص را (به‌جز دلاری‌ها) پایین می‌برد.`);
    return lines;
  };

  // ============================================================ سهام و صندوق
  E.stockSignal = (sym, market, rows, ct, inter, newsOverall, minScore) => {
    const c = rows.map(r => +r.close);
    if (c.length < 35) return E.Signal(sym, market, 'HOLD', 0, c.length ? U.last(c) : null, ['داده کافی نیست']);
    let score = 0; const why = [];
    const last = U.last(c), r = U.rsi(c);
    if (r < 30) { score += 1; why.push(`RSI=${r.toFixed(0)} اشباع فروش`); }
    else if (r > 70) { score -= 1; why.push(`RSI=${r.toFixed(0)} اشباع خرید`); }
    const [m, sg] = U.macd(c), n = m.length;
    if (m[n - 1] > sg[n - 1] && m[n - 3] <= sg[n - 3]) { score += 1; why.push('کراس صعودی MACD'); }
    else if (m[n - 1] < sg[n - 1] && m[n - 3] >= sg[n - 3]) { score -= 1; why.push('کراس نزولی MACD'); }
    const ma20 = U.rollMean(c, 20), ma50 = U.rollMean(c, Math.min(50, c.length));
    if (last > ma20 && ma20 > ma50) { score += 1; why.push('روند صعودی (قیمت > MA20 > MA50)'); }
    else if (last < ma20 && ma20 < ma50) { score -= 1; why.push('روند نزولی (قیمت < MA20 < MA50)'); }
    const sd = U.rollStd(c, 20);
    if (last < ma20 - 2 * sd) { score += 0.5; why.push('زیر باند پایین بولینگر'); }
    else if (last > ma20 + 2 * sd) { score -= 0.5; why.push('بالای باند بالای بولینگر'); }
    const vols = rows.map(r => +r.volume);
    const volRatio = U.last(vols) / Math.max(U.mean(vols.slice(-21, -1)), 1);
    const dayChg = last / c[c.length - 2] - 1;
    if (volRatio > 2) { const s = dayChg > 0 ? 1 : -1; score += s; why.push(`حجم ${volRatio.toFixed(1)} برابر میانگین ماه با ${s > 0 ? 'رشد' : 'افت'} قیمت`); }

    // ---- رفتار حقیقی/حقوقی (مخصوص بازار ایران)
    if (ct && ct.length >= 5) {
      const t = U.last(ct);
      const bpc = t.buy_CountI ? t.buy_I_Volume / t.buy_CountI : 0, spc = t.sell_CountI ? t.sell_I_Volume / t.sell_CountI : 0;
      if (bpc && spc) {
        const power = bpc / spc;
        if (power >= 1.5) { score += 2; why.push(`قدرت خریدار حقیقی ${power.toFixed(2)} (سرانه خرید قوی)`); }
        else if (power <= 0.67) { score -= 2; why.push(`قدرت فروشنده حقیقی بالا (نسبت ${power.toFixed(2)})`); }
      }
      const flow = ct.slice(-5).reduce((s, x) => s + (x.buy_I_Volume - x.sell_I_Volume) * last, 0);
      if (Math.abs(flow) > 0) {
        const s = flow > 0 ? 1 : -1; score += s;
        why.push(`${s > 0 ? 'ورود' : 'خروج'} پول حقیقی ۵ روز ≈ ${U.fmt(Math.abs(flow) / 1e10)} میلیارد تومان`);
      }
    }
    score += inter[0]; why.push(...inter[1]);
    if (Math.abs(newsOverall) >= 0.5) { score += 0.5 * Math.sign(newsOverall); why.push(`فضای کلی اخبار ${newsOverall > 0 ? 'مثبت' : 'منفی'}`); }

    const a = U.atr(rows.map(r => ({ high: +r.high, low: +r.low, close: +r.close })));
    const act = decide(score, minScore);
    const sig = E.Signal(sym, market, act, U.round(score, 1), last, why,
      { rsi: U.round(r, 1), chg_1d: U.round(dayChg * 100, 2), vol_ratio: U.round(volRatio, 2) });
    if (act === 'BUY' && fin(a)) { sig.stop = Math.round(last - 2 * a); sig.target = Math.round(last + 3 * a); }
    return sig;
  };

  // ============================================================ اختیار معامله (بلک-شولز با نوسان تاریخی)
  const ncdf = x => 0.5 * (1 + U.erf(x / Math.SQRT2));
  E.blackScholes = (S, K, T, r, sigma, kind) => {
    if (T <= 0 || sigma <= 0) return kind === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    const d1 = (Math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T)), d2 = d1 - sigma * Math.sqrt(T);
    return kind === 'call' ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2) : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
  };
  E.optionSignal = (sym, opt, premium, underRows, expiryG, today, r) => {
    const c = underRows.map(x => +x.close), S = U.last(c);
    const lr = c.slice(1).map((x, i) => Math.log(x / c[i])).filter(Number.isFinite).slice(-60);
    const sigma = U.std(lr) * Math.sqrt(TRADING_DAYS);
    const T = Math.max(U.daysBetween(today, expiryG), 0) / 365;
    const fair = E.blackScholes(S, opt.strike, T, Math.log(1 + r), sigma, opt.kind);
    const intrinsic = opt.kind === 'call' ? Math.max(0, S - opt.strike) : Math.max(0, opt.strike - S);
    const be = opt.kind === 'call' ? opt.strike + premium : opt.strike - premium;
    const ratio = fair > 0 ? premium / fair : Infinity;
    const f0 = x => U.fmt(x);
    const why = [`پایه ${opt.underlying}=${f0(S)}، اعمال ${f0(opt.strike)}، ${Math.floor(T * 365)} روز مانده`,
      `ارزش منصفانه (BS، نوسان تاریخی ${(sigma * 100).toFixed(0)}٪) ≈ ${f0(fair)} | قیمت ${f0(premium)}`,
      `سربه‌سر ${f0(be)} (${((be / S - 1) * 100) >= 0 ? '+' : ''}${((be / S - 1) * 100).toFixed(1)}٪ از قیمت پایه) | ارزش ذاتی ${f0(intrinsic)}`];
    if (premium < intrinsic * 0.98) why.push('⚠️ زیر ارزش ذاتی — فرصت آربیتراژ احتمالی');
    const act = ratio < 0.8 ? 'BUY' : ratio > 1.25 ? 'SELL' : 'HOLD';
    if (act === 'SELL') why.push('گران نسبت به مدل → مناسب فروش/پوشش (کاورد کال) نه خرید');
    return E.Signal(sym, 'اختیار', act, Number.isFinite(ratio) ? U.round(Math.max(-10, Math.min(10, (1 - ratio) * 10)), 1) : -10, premium, why,
      { fair: Math.round(fair), sigma: U.round(sigma * 100, 1), lev: premium ? U.round(S / premium, 1) : null });
  };

  // ============================================================ سکه و طلا (حباب)
  const GOLD_PURE_GRAMS = { coin_emami: 8.13552 * 0.9, coin_half: 4.0678 * 0.9, coin_quarter: 2.0339 * 0.9 };
  E.goldSignals = (local, sellTh, buyTh) => {
    const out = [];
    const ons = (local.ounce || {}).price, usd = (local.usd_irr || {}).price;
    if (!ons || !usd) return out;
    const gramPure = ons / 31.1035 * usd;
    const g18 = (local.gold_18k || {}).price, sg = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    if (g18) {
      const intr = gramPure * 0.75, bub = (g18 / intr - 1) * 100;
      out.push(E.Signal('طلای ۱۸ عیار (گرم)', 'طلا و سکه', bub > 8 ? 'SELL' : bub < -1 ? 'BUY' : 'HOLD', U.round(-bub, 1), g18,
        [`ارزش ذاتی ≈ ${U.fmt(intr)} ریال | حباب ${sg(bub)}٪`], { bubble: U.round(bub, 1) }));
    }
    const names = { coin_emami: 'سکه امامی', coin_half: 'نیم سکه', coin_quarter: 'ربع سکه' };
    for (const [k, grams] of Object.entries(GOLD_PURE_GRAMS)) {
      const p = (local[k] || {}).price;
      if (!p) continue;
      const intr = gramPure * grams, bub = (p / intr - 1) * 100;
      out.push(E.Signal(names[k], 'طلا و سکه', bub > sellTh ? 'SELL' : bub < buyTh ? 'BUY' : 'HOLD', U.round(-bub, 1), p,
        [`ارزش ذاتی ≈ ${U.fmt(intr)} ریال (انس ${U.fmt(ons)}$ × دلار ${U.fmt(usd)})`, `حباب ${sg(bub)}٪`], { bubble: U.round(bub, 1) }));
    }
    return out;
  };

  IM.Engine = E;
})(window.IM = window.IM || {});
