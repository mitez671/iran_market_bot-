/* شاخص‌های مالی محاسباتی (بدون شبکه و بدون DOM):
   - دلار ضمنی: دلاری که قیمت داخلی طلا/سکه با انس جهانی «فرض» می‌کند، در مقایسه با دلار آزاد
   - نرخ مؤثر تسهیلات بانکی با سپرده‌گذاری (با احتساب هزینه‌ی فرصت سپرده) */
(function (IM) {
  const { U } = IM;
  const F = {};
  const OZ = 31.1034768;                         // گرم در هر انس تروی

  // ============================================================ دلار ضمنی
  // گرم طلای خالص در هر واحد. مثقال tgju = مثقال آبشده‌ی ۱۷ عیار (۴٫۶۰۸۳ گرم با عیار ۷۰۵).
  F.GOLD_ITEMS = [
    { key: 'geram18', label: 'طلای ۱۸ عیار (گرم)', pure: 0.75, core: true },
    { key: 'mesghal', label: 'مثقال طلای آبشده', pure: 4.6083 * 0.705, core: true },
    { key: 'geram24', label: 'طلای ۲۴ عیار (گرم)', pure: 0.995 },
    { key: 'sekee', label: 'سکه امامی', pure: 8.13552 * 0.9 },
    { key: 'nim', label: 'نیم سکه', pure: 4.0678 * 0.9 },
    { key: 'rob', label: 'ربع سکه', pure: 2.0339 * 0.9 },
  ];

  /** cur = داده‌ی خام tgju ({key: {p, dp}}). خروجی: {usd, ounce, rows, core, gap} — همه به ریال */
  F.impliedUsd = cur => {
    const price = k => U.toNum(((cur || {})[k] || {}).p);
    const usd = price('price_dollar_rl'), ounce = price('ons');
    const rows = [];
    if (ounce > 0) {
      for (const it of F.GOLD_ITEMS) {
        const p = price(it.key);
        if (!(p > 0)) continue;
        const implied = p / (ounce / OZ * it.pure);
        rows.push({ item: it.label, kind: it.core ? 'طلای خام' : 'سکه و ۲۴ عیار', price: p, implied_usd: implied,
          gap_pct: usd > 0 ? (implied / usd - 1) * 100 : null, core: !!it.core });
      }
    }
    const tether = price('crypto-tether-irr');
    if (tether > 0) rows.push({ item: 'تتر (USDT)', kind: 'رمزارز', price: tether, implied_usd: tether, gap_pct: usd > 0 ? (tether / usd - 1) * 100 : null });
    const coreVals = rows.filter(r => r.core).map(r => r.implied_usd);
    const core = coreVals.length ? U.mean(coreVals) : null;
    return { usd, ounce, rows, core, gap: core && usd > 0 ? (core / usd - 1) * 100 : null };
  };

  /** تفسیر فاصله‌ی دلار ضمنی طلای خام با دلار آزاد */
  F.impliedNote = r => {
    if (r.gap == null) return 'داده‌ی کافی نیست (دلار آزاد، انس جهانی و طلای ۱۸ یا مثقال از tgju لازم است).';
    const g = r.gap, s = `${g >= 0 ? '+' : ''}${g.toFixed(1)}٪`;
    if (g > 3) return `دلار ضمنی طلا ${s} بالاتر از دلار آزاد است: طلای داخلی نسبت به دلار گران است، یا بازار طلا انتظار گران شدن دلار را زودتر قیمت کرده است.`;
    if (g < -3) return `دلار ضمنی طلا ${s} پایین‌تر از دلار آزاد است: طلای داخلی نسبت به دلار ارزان است (یا دلار آزاد هیجانی بالا رفته).`;
    return `دلار ضمنی طلا با دلار آزاد هم‌خوان است (${s}).`;
  };

  // ============================================================ تسهیلات با سپرده‌گذاری
  // واحد مبالغ: میلیون تومان (هر واحدی، فقط یکسان). نرخ‌ها: درصد سالانه.
  // plan = { bank, name, deposit, wait, block, dep_rate, loan, rate, months, fee }
  //   wait = ماه‌های خواباندن سپرده قبل از گرفتن وام؛ block = درصد سپرده که بعد از وام مسدود می‌ماند؛ block_months = چند ماه (خالی = تا پایان اقساط)
  //   dep_rate = سود سالانه‌ای که بانک به سپرده می‌دهد (قرض‌الحسنه = ۰)؛ fee = کارمزد/هزینه‌ی یک‌باره٪ از مبلغ وام
  F.PLAN_FIELDS = [
    ['bank', 'بانک', 'text'], ['name', 'نام طرح', 'text'],
    ['deposit', 'مبلغ سپرده (میلیون ت)', 'num'], ['wait', 'ماه‌های سپرده قبل از وام', 'num'],
    ['block', 'درصد سپرده‌ی مسدود بعد از وام', 'num'], ['block_months', 'ماه‌های مسدودی بعد از وام (خالی = تا پایان اقساط)', 'num'], ['dep_rate', 'سود سالانه‌ی سپرده٪', 'num'],
    ['loan', 'مبلغ وام (میلیون ت)', 'num'], ['rate', 'نرخ اسمی وام٪', 'num'],
    ['months', 'تعداد اقساط (ماه)', 'num'], ['fee', 'کارمزد یک‌باره٪ از وام', 'num'],
  ];

  // ---------------------------------------------------------------- استخراج طرح از متن صفحه‌ی بانک
  // (۱) الگوی ساده: عددها را با کلمه‌های اطرافشان تشخیص می‌دهد؛ تقریبی است و کاربر باید تأیید کند.
  const WORDN = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'دوازده': 12, 'پانزده': 15, 'هجده': 18, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60 };
  const prep = t => U.digits(String(t || '')).replace(/٫/g, '.').replace(/\u200c/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(new RegExp(`(^|[\\s(])(${Object.keys(WORDN).sort((a, b) => b.length - a.length).join('|')})(?=\\s*(برابر|ماه|ساله|سال|درصد|میلیون|میلیارد))`, 'g'), (m, a, w) => a + WORDN[w]);
  /** از بین گروه‌های کلمه، کدام نزدیک‌ترین کلمه را قبل از موقعیت i دارد (در back نویسه‌ی قبل) */
  const closest = (s, i, groups, back = 60) => {
    const w = s.slice(Math.max(0, i - back), i); let best = null, at = -1;
    for (const [k, re] of Object.entries(groups)) for (const m of w.matchAll(new RegExp(re.source, 'g'))) if (m.index + m[0].length > at) { at = m.index + m[0].length; best = k; }
    return best;
  };
  F.parseLoanText = (text, bank = '') => {
    const t = prep(text);
    const sents = t.split(/\n+|(?<=[.!؟؛])\s+/).map(x => x.trim()).filter(Boolean);
    const blocks = []; let cur = null;
    for (const s of sents) {
      if (/طرح|بسته/.test(s) && (!cur || cur.length > 80)) { if (cur) blocks.push(cur); cur = s; }
      else cur = cur ? cur + '\n' + s : s;
      if (cur && cur.length > 1500) { blocks.push(cur); cur = null; }
    }
    if (cur) blocks.push(cur);
    const out = [];
    for (const b of blocks) {
      if (!/وام|تسهیلات/.test(b)) continue;
      const p = { bank, name: b.split('\n')[0].slice(0, 70) };
      for (const m of b.matchAll(/(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)/g)) {
        const v = +m[1], k = closest(b, m.index, { dep: /سود\s*(سپرده|حساب)/, fee: /کارمزد\s*(یک|ابتدا|پرداخت|اولیه)|هزینه/, rate: /نرخ|کارمزد|سود|بهره/ });
        if (k === 'dep' && p.dep_rate == null) p.dep_rate = v;
        else if (k === 'fee' && p.fee == null && v < 10) p.fee = v;
        else if (k === 'rate' && p.rate == null && v <= 40) p.rate = v;
      }
      for (const m of b.matchAll(/(\d+)\s*(ماهه|ماه|ساله|سال)/g)) {
        const v = /سال/.test(m[2]) ? +m[1] * 12 : +m[1];
        const k = closest(b, m.index, { months: /بازپرداخت|باز پرداخت|اقساط|قسط|مدت\s*(وام|تسهیلات)|تقسیط/, wait: /سپرده|میانگین|نگهداری|نگه\s*داری|انتظار|بلوکه|رسوب|افتتاح/ });
        if (k === 'months' && p.months == null && v <= 240) p.months = v;
        else if (k === 'wait' && p.wait == null && v <= 60) p.wait = v;
      }
      for (const m of b.matchAll(/(\d+(?:[.,]\d+)?)\s*(میلیارد|میلیون)\s*(تومان|ریال)?/g)) {
        let v = +m[1].replace(',', '.') * (m[2] === 'میلیارد' ? 1000 : 1); if (m[3] === 'ریال') v /= 10;
        const k = closest(b, m.index, { deposit: /سپرده|میانگین|موجودی|رسوب|واریز/, loan: /وام|تسهیلات|سقف|مبلغ/ });
        if (k === 'deposit' && p.deposit == null) p.deposit = v;
        else if (k === 'loan' && p.loan == null) p.loan = v;
      }
      const mult = b.match(/(\d+(?:\.\d+)?)\s*برابر/);
      if (mult) { const k = +mult[1]; if (p.deposit != null && p.loan == null) p.loan = p.deposit * k; else if (p.loan != null && p.deposit == null) p.deposit = p.loan / k; }
      if (/مسدود|بلوکه/.test(b) && /تا\s*(پایان|انتها|انتهای|تسویه)\s*(اقساط|بازپرداخت|تسهیلات|وام)?/.test(b)) p.block = 100;
      const found = ['deposit', 'loan', 'rate', 'months', 'wait'].filter(k => p[k] != null).length;
      if (p.rate != null && found >= 3) out.push({ ...p, auto: 'الگو', found });
    }
    return out;
  };

  // (۲) Claude: پرامپت و خواندن پاسخ JSON
  F.loanPrompt = (bank, text) => `متن زیر از صفحه‌ی طرح‌های تسهیلات «${bank}» است. همه‌ی طرح‌های وامی را که به سپرده‌گذاری (یا میانگین حساب) وابسته‌اند استخراج کن.
فقط یک آرایه‌ی JSON بده، بدون هیچ توضیحی. هر عنصر:
{"name": نام طرح, "deposit": مبلغ سپرده, "wait": ماه‌های نگه‌داشتن سپرده قبل از وام, "block": درصد سپرده که تا پایان اقساط مسدود می‌ماند (۰ اگر هنگام وام آزاد می‌شود), "dep_rate": سود سالانه‌ی سپرده٪ (قرض‌الحسنه ۰), "loan": مبلغ وام, "rate": نرخ سالانه‌ی وام٪, "months": تعداد اقساط, "fee": کارمزد یک‌باره٪ از وام}
مبالغ به میلیون تومان. اگر وام چند برابر سپرده است، هر دو مبلغ را برای یک نمونه‌ی معمول بنویس. اگر طرح چند پله دارد، هر پله یک عنصر جدا با name متفاوت.
اگر عددی در متن نیامده null بگذار و حدس نزن. اگر طرحی نیست [] بده.

متن:
${String(text || '').slice(0, 15000)}`;
  F.parseLoanJson = (str, bank = '') => {
    const s = String(str || ''), a = s.indexOf('['), z = s.lastIndexOf(']');
    if (a < 0 || z < a) throw new Error('آرایه‌ی JSON در پاسخ پیدا نشد');
    const arr = JSON.parse(s.slice(a, z + 1));
    if (!Array.isArray(arr)) throw new Error('پاسخ آرایه نیست');
    const num = v => { const n = U.toNum(v == null ? null : String(v).replace(/٫/g, '.')); return n == null || !Number.isFinite(n) ? undefined : n; };
    return arr.filter(x => x && typeof x === 'object').map(x => {
      const p = { bank, name: String(x.name || '').slice(0, 80), auto: 'Claude' };
      ['deposit', 'wait', 'block', 'dep_rate', 'loan', 'rate', 'months', 'fee'].forEach(k => { const v = num(x[k]); if (v !== undefined) p[k] = v; });
      return p;
    }).filter(p => p.rate != null || p.loan != null);
  };

  F.payment = (L, ratePct, n) => { const r = ratePct / 1200; return r ? L * r / (1 - (1 + r) ** -n) : L / n; };

  /** نرخ ماهانه k که ارزش فعلی n قسط مساوی pmt برابر pv شود (دوبخشی) */
  const solveRate = (pv, pmt, n) => {
    const f = k => (Math.abs(k) < 1e-12 ? pmt * n : pmt * (1 - (1 + k) ** -n) / k) - pv;
    let lo = -0.99, hi = 5;
    if (f(lo) < 0 || f(hi) > 0) return null;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };

  /** altPct = بازده سالانه‌ی جایگزین (مؤثر) که سپرده می‌توانست بگیرد */
  F.loanCalc = (p, altPct) => {
    const n = Math.round(+p.months || 0), W = Math.max(0, Math.round(+p.wait || 0));
    const D = +p.deposit || 0, L = +p.loan || 0, b = Math.min(100, Math.max(0, +p.block || 0)) / 100;
    if (!(L > 0) || !(n > 0)) return { error: 'مبلغ وام و تعداد اقساط لازم است' };
    const i = (1 + altPct / 100) ** (1 / 12) - 1, di = (+p.dep_rate || 0) / 1200;
    const pmt = F.payment(L, +p.rate || 0, n);
    // هزینه‌ی فرصت سپرده، به ارزش روز گرفتن وام (ماه W)
    let cost = D * (1 + i) ** W;
    for (let t = 1; t <= W; t++) cost -= D * di * (1 + i) ** (W - t);            // سود سپرده در دوره‌ی انتظار
    cost -= D * (1 - b);                                                          // بخش آزادشده هنگام وام
    const B = +p.block_months > 0 ? Math.min(n, Math.round(+p.block_months)) : n;  // بخش مسدود بعد از B ماه (پیش‌فرض: پایان اقساط) برمی‌گردد
    let pvBlocked = b * D * (1 + i) ** -B;
    for (let t = 1; t <= B; t++) pvBlocked += b * D * di * (1 + i) ** -t;
    cost -= pvBlocked;
    const net = L * (1 - (+p.fee || 0) / 100) - cost;                            // پول واقعی‌ای که از وام دستت می‌رسد
    const k = net > 0 ? solveRate(net, pmt, n) : null;
    const eff = k == null ? null : ((1 + k) ** 12 - 1) * 100;
    let verdict;
    if (net <= 0) verdict = 'هزینه‌ی خواباندن سپرده از خود وام بیشتر است';
    else if (eff == null) verdict = 'قابل محاسبه نیست';
    else if (eff < altPct - 2) verdict = `ارزان‌تر از بازده جایگزین (${altPct.toFixed(1)}٪)`;
    else if (eff > altPct + 2) verdict = `گران‌تر از بازده جایگزین (${altPct.toFixed(1)}٪)`;
    else verdict = `نزدیک بازده جایگزین (${altPct.toFixed(1)}٪)`;
    return { pmt, total: pmt * n, cost, net, eff, ratio: D > 0 ? L / D : null, verdict };
  };

  // ============================================================ صرف ریسک سهام
  // بازده سود بازار (E/P = جمع سود ÷ جمع ارزش بازار) در مقایسه با بازده بدون ریسک (میانه اخزا).
  // نام گروه‌ها از کد گروه صنعت TSETMC (cs)؛ گروه ناشناخته با کدش نشان داده می‌شود.
  F.SECTORS = { '01': 'زراعت', '10': 'ذغال سنگ', '11': 'استخراج نفت و گاز', '13': 'کانه‌های فلزی', '14': 'سایر معادن', '17': 'منسوجات', '19': 'چرم',
    '20': 'محصولات چوبی', '21': 'محصولات کاغذی', '22': 'انتشار و چاپ', '23': 'فرآورده‌های نفتی', '25': 'لاستیک و پلاستیک', '27': 'فلزات اساسی',
    '28': 'محصولات فلزی', '29': 'ماشین‌آلات و تجهیزات', '31': 'دستگاه‌های برقی', '32': 'ارتباطات و رادیو', '33': 'ابزار پزشکی و اپتیکی',
    '34': 'خودرو و قطعات', '35': 'سایر تجهیزات حمل‌ونقل', '36': 'مبلمان', '38': 'قند و شکر', '39': 'چندرشته‌ای صنعتی', '40': 'برق، گاز و آب',
    '41': 'جمع‌آوری و توزیع آب', '42': 'غذایی بجز قند', '43': 'دارویی', '44': 'شیمیایی', '45': 'پیمانکاری صنعتی', '46': 'تجارت عمده',
    '47': 'خرده‌فروشی', '49': 'کاشی و سرامیک', '51': 'حمل‌ونقل هوایی', '52': 'انبارداری و حمل‌ونقل', '53': 'سیمان، آهک و گچ',
    '54': 'سایر کانی غیرفلزی', '55': 'هتل و رستوران', '56': 'سرمایه‌گذاری‌ها', '57': 'بانک‌ها و موسسات اعتباری', '58': 'سایر واسطه‌گری‌های مالی',
    '60': 'حمل‌ونقل', '61': 'حمل‌ونقل آبی', '64': 'مخابرات', '65': 'واسطه‌گری مالی و پولی', '66': 'بیمه و صندوق بازنشستگی',
    '67': 'فعالیت‌های کمکی مالی', '70': 'انبوه‌سازی و املاک', '71': 'فعالیت مهندسی', '72': 'رایانه', '73': 'اطلاعات و ارتباطات',
    '74': 'خدمات فنی و مهندسی', '77': 'اجاره و لیزینگ', '90': 'سایر', '93': 'فرهنگی و ورزشی' };
  F.sectorName = g => { const k = String(g == null ? '' : g).trim().padStart(2, '0'); return F.SECTORS[k] || (k && k !== '00' ? `گروه ${k}` : 'نامشخص'); };

  /** رشد سالانه‌ی سود که لازم است تا بازده سهام به بازده اخزا برسد (گوردون با تقسیم کامل سود: r = E/P×(1+g) + g) */
  F.requiredGrowth = (epPct, ytmPct) => epPct == null || ytmPct == null ? null : ((ytmPct - epPct) / (100 + epPct)) * 100;

  /** mw = دیده‌بان کامل؛ ytm = بازده بدون ریسک٪ (یا null). خروجی: {market, sectors, stocks} */
  F.equityPremium = (mw, ytm) => {
    const st = (mw || []).filter(r => r.category === 'سهام' && r.close > 0 && r.shares > 0);
    const agg = rows => {
      const cap = rows.reduce((s, r) => s + r.close * r.shares, 0);
      const withEps = rows.filter(r => r.eps != null);
      const capE = withEps.reduce((s, r) => s + r.close * r.shares, 0), earn = withEps.reduce((s, r) => s + r.eps * r.shares, 0);
      const ep = capE > 0 ? earn / capE * 100 : null;
      const pes = withEps.filter(r => r.eps > 0).map(r => r.close / r.eps);
      return { count: rows.length, cap_bn_toman: cap / 1e10, coverage: cap > 0 ? capE / cap * 100 : null, ep,
        pe: earn > 0 ? capE / earn : null, median_pe: pes.length ? U.median(pes) : null,
        loss_makers: withEps.filter(r => r.eps < 0).length,
        erp: ep != null && ytm != null ? ep - ytm : null, req_growth: F.requiredGrowth(ep, ytm) };
    };
    const market = { ...agg(st), ytm };
    const by = {};
    st.forEach(r => { (by[F.sectorName(r.group)] = by[F.sectorName(r.group)] || []).push(r); });
    const sectors = Object.entries(by).map(([sector, rows]) => ({ sector, ...agg(rows) })).filter(x => x.ep != null)
      .sort((a, b) => b.cap_bn_toman - a.cap_bn_toman);
    // نمادهای نقدشونده (معامله‌شده امروز) که بازده سودشان از اخزا بیشتر است
    const stocks = st.filter(r => r.eps > 0 && r.value > 0).map(r => ({ symbol: r.symbol, name: r.name, sector: F.sectorName(r.group), close: r.close,
      eps: r.eps, pe: r.close / r.eps, ep: r.eps / r.close * 100, erp: ytm != null ? r.eps / r.close * 100 - ytm : null,
      cap_bn_toman: r.close * r.shares / 1e10, value_bn_toman: r.value / 1e10 }))
      .filter(r => ytm == null || r.erp > 0).sort((a, b) => b.ep - a.ep);
    return { market, sectors, stocks };
  };

  /** متن تفسیر برای خلاصه و Claude. hist = سری تاریخی [[date, erp]] */
  F.premiumNote = (m, hist = []) => {
    if (m.ep == null) return 'داده‌ی کافی نیست (دیده‌بان TSETMC با EPS و تعداد سهام لازم است).';
    const f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
    const lines = [`P/E بازار ${f(m.pe)} (میانه‌ی نمادهای سودده ${f(m.median_pe)})، بازده سود بازار (E/P) ${f(m.ep)}٪، پوشش EPS ${f(m.coverage, 0)}٪ ارزش بازار، ${m.loss_makers} نماد زیان‌ده.`];
    if (m.ytm == null) { lines.push('بازده اخزا در دسترس نیست؛ صرف ریسک حساب نشد.'); return lines.join('\n'); }
    lines.push(`بازده بدون ریسک (میانه اخزا) ${f(m.ytm)}٪ ← صرف ریسک ساده‌ی سهام ${m.erp >= 0 ? '+' : ''}${f(m.erp)}٪.`);
    lines.push(m.req_growth <= 0
      ? 'بازده سود سهام حتی بدون رشد سود از اخزا بیشتر است: سهام نسبت به اوراق ارزان است.'
      : `برای اینکه سهام هم‌اندازه‌ی اخزا بازده بدهد، سود شرکت‌ها باید سالانه حدود ${f(m.req_growth)}٪ رشد کند. اگر تورم مورد انتظارت از این بیشتر است (و سودها همپای تورم بالا می‌روند)، سهام نسبت به اوراق ارزان است؛ اگر کمتر است، گران است.`);
    const v = hist.map(x => x[1]);
    if (v.length >= 10) {
      const below = v.filter(x => x < m.erp).length / v.length * 100;
      lines.push(`نسبت به ${v.length} روز ثبت‌شده‌ی قبلی: کمینه ${f(Math.min(...v))}٪، بیشینه ${f(Math.max(...v))}٪؛ صرف ریسک امروز از ${f(below, 0)}٪ روزها بالاتر است (هرچه بالاتر، سهام ارزان‌تر).`);
    } else lines.push(`سابقه: ${v.length} روز ثبت شده؛ از ۱۰ روز به بعد مقایسه با گذشته هم نشان داده می‌شود.`);
    return lines.join('\n');
  };

  // ============================================================ کاورد کال
  // خرید سهم پایه + فروش اختیار خرید روی همان سهم، نگه‌داشتن تا سررسید.
  // قیمت اجرایی: سهم با بهترین قیمت فروش (ask) خریده می‌شود و اختیار با بهترین قیمت خرید (bid) فروخته می‌شود؛ اگر سفارشی نبود، آخرین معامله.
  // cc = { buy_fee_pct, sell_fee_pct, option_fee_pct, min_days, max_days }
  const annual = (r, days) => (r > -1 && days > 0 ? ((1 + r) ** (365 / days) - 1) * 100 : null);
  F.coveredCalls = (mw, today, ytm, cc = {}) => {
    const bySym = {};
    (mw || []).forEach(r => { if (r.symbol) bySym[U.normalize(r.symbol)] = r; });
    const b = (cc.buy_fee_pct ?? 0.3712) / 100, s = (cc.sell_fee_pct ?? 0.88) / 100, o = (cc.option_fee_pct ?? 0.103) / 100;
    const minD = cc.min_days ?? 3, maxD = cc.max_days ?? 400;
    const out = [];
    let unmatched = 0;
    for (const r of mw || []) {
      if (r.category !== 'اختیار خرید') continue;
      const opt = IM.Tsetmc.parseOptionName(r.name);
      if (!opt || opt.kind !== 'call' || !(opt.strike > 0)) continue;
      const u = bySym[U.normalize(opt.underlying)];
      if (!u) { unmatched++; continue; }
      const iso = U.jalaliToGregorian(opt.expiry_jalali);
      const days = iso ? U.daysBetween(today, iso) : null;
      if (days == null || days < minD || days > maxD) continue;
      const S = u.ask > 0 ? u.ask : u.last > 0 ? u.last : u.close, C = r.bid > 0 ? r.bid : r.last > 0 ? r.last : null;
      if (!(S > 0) || !(C > 0)) continue;
      const K = opt.strike, cost = S * (1 + b) - C * (1 - o);
      if (!(cost > 0)) continue;
      const rCall = K * (1 - s) / cost - 1, rFlat = Math.min(S, K) * (1 - s) / cost - 1;
      const breakeven = cost / (1 - s);
      const row = { symbol: r.symbol, underlying: opt.underlying, strike: K, S, C, days, expiry: opt.expiry_jalali,
        moneyness: (S / K - 1) * 100, premium_pct: C / S * 100,
        ret_call: rCall * 100, ann_call: annual(rCall, days), ret_flat: rFlat * 100, ann_flat: annual(rFlat, days),
        breakeven, protection: (1 - breakeven / S) * 100,
        vs_ytm: ytm != null && annual(rFlat, days) != null ? annual(rFlat, days) - ytm : null,
        live: u.ask > 0 && r.bid > 0, opt_value_bn: (r.value || 0) / 1e10 };
      row.price_src = row.live ? 'سفارش‌های باز' : 'آخرین معامله';
      out.push(row);
    }
    out.sort((a, b2) => (b2.ann_flat ?? -1e9) - (a.ann_flat ?? -1e9));
    out.unmatched = unmatched;
    return out;
  };

  /** خلاصه‌ی متنی: بهترین‌های قابل اجرا با حاشیه‌ی امنیت معقول */
  F.coveredNote = (rows, ytm, minProt = 5) => {
    if (!rows.length) return 'هیچ اختیار خریدی با قیمت قابل محاسبه پیدا نشد (دیده‌بان TSETMC با بخش مشتقه لازم است).';
    const f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
    const good = rows.filter(r => r.live && r.protection >= minProt && r.days >= 14);
    const beat = ytm != null ? good.filter(r => r.ann_flat > ytm) : [];
    const lines = [`${rows.length} قرارداد اختیار خرید بررسی شد (${rows.filter(r => r.live).length} با سفارش باز خرید و فروش).` +
      (rows.unmatched ? ` ${rows.unmatched} قرارداد سهم پایه‌اش در دیده‌بان پیدا نشد.` : '')];
    if (ytm != null) lines.push(`از قراردادهای با سفارش باز، حداقل ۱۴ روز تا سررسید و حاشیه‌ی امنیت ≥ ${minProt}٪: ${beat.length} مورد اگر قیمت سهم ثابت بماند از اخزا (${f(ytm)}٪) بازده بیشتری می‌دهد.`);
    const top = (beat.length ? beat : good).slice(0, 5);
    if (top.length) lines.push('بهترین‌ها: ' + top.map(r => `${r.symbol} (پایه ${r.underlying}، ${r.days} روز، سالانه ${f(r.ann_flat)}٪، حاشیه ${f(r.protection)}٪)`).join('، '));
    lines.push('«بازده با قیمت ثابت» = اگر قیمت سهم تا سررسید تغییر نکند. «بازده در صورت اعمال» = اگر سهم بالای قیمت اعمال برود (سقف سود). «حاشیه‌ی امنیت» = سهم چند درصد می‌تواند افت کند تا به سربه‌سر برسی. کارمزدها تقریبی‌اند و در تنظیمات (covered_call) قابل تغییرند. ریسک اصلی: افت سهم بیشتر از حاشیه‌ی امنیت.');
    return lines.join('\n');
  };

  // ============================================================ حباب صندوق‌ها
  // حباب = قیمت تابلو ÷ NAV ابطال − ۱. NAV را مدیر صندوق اعلام می‌کند (معمولاً روزانه)، پس در ساعت معاملات کمی عقب است.
  F.fundBubbles = (mw, navData) => {
    const navs = (navData && navData.navs) || {};
    return (mw || []).filter(r => navs[r.ins_code] && navs[r.ins_code].cancel > 0).map(r => {
      const n = navs[r.ins_code], px = r.close > 0 ? r.close : r.last;
      return { symbol: r.symbol, name: r.name, category: r.category, close: r.close, last: r.last, nav: n.cancel, nav_issue: n.issue,
        bubble: px > 0 ? (px / n.cancel - 1) * 100 : null, bubble_last: r.last > 0 ? (r.last / n.cancel - 1) * 100 : null,
        value_bn_toman: (r.value || 0) / 1e10, nav_date: n.date };
    }).filter(r => r.bubble != null).sort((a, b) => b.bubble - a.bubble);
  };

  /** خلاصه‌ی هر دسته: میانه و میانگین وزنی (با ارزش معاملات) حباب */
  F.bubbleSummary = rows => {
    const by = {};
    rows.forEach(r => { (by[r.category] = by[r.category] || []).push(r); });
    return Object.entries(by).map(([category, rs]) => {
      const w = rs.reduce((s, r) => s + r.value_bn_toman, 0);
      return { category, count: rs.length, median: U.median(rs.map(r => r.bubble)),
        weighted: w > 0 ? rs.reduce((s, r) => s + r.bubble * r.value_bn_toman, 0) / w : null,
        max: Math.max(...rs.map(r => r.bubble)), min: Math.min(...rs.map(r => r.bubble)) };
    });
  };

  const BUBBLE_HINT = {
    'صندوق طلا و کالا': 'حباب مثبت یعنی طلا را از طریق صندوق گران‌تر از ارزش دارایی‌اش می‌خری؛ حباب منفی یعنی تخفیف.',
    'صندوق درآمد ثابت': 'باید نزدیک صفر باشد؛ حباب منفی محسوس یعنی خرید زیر NAV (بازده بیشتر از صندوق)، حباب مثبت یعنی نخر.',
    'صندوق اهرمی': 'حباب بالا معمولاً نشانه‌ی هیجان خرید است و در افت بازار سریع‌تر از NAV می‌ریزد.',
    'صندوق سهامی/مختلط': 'حباب مثبت = تقاضای هیجانی؛ حباب منفی = فرصت خرید سبد سهام زیر ارزش.',
  };
  F.bubbleNote = (rows, alertPct = 3) => {
    if (!rows.length) return 'NAV صندوق‌ها دریافت نشده. منبع «TSETMC — NAV صندوق‌ها (حباب)» را در تب «سایت‌ها و VPN» ببین (بعد از دیده‌بان کل بازار گرفته می‌شود).';
    const f = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}٪`);
    const lines = F.bubbleSummary(rows).map(s => `${s.category} (${s.count}): میانه ${f(s.median)}، میانگین وزنی با ارزش معاملات ${f(s.weighted)}، از ${f(s.min)} تا ${f(s.max)}. ${BUBBLE_HINT[s.category] || ''}`);
    const hi = rows.filter(r => r.bubble >= alertPct && r.value_bn_toman > 0).slice(0, 5), lo = rows.filter(r => r.bubble <= -alertPct && r.value_bn_toman > 0).slice(-5).reverse();
    if (hi.length) lines.push(`بیشترین حباب (معامله‌شده امروز): ${hi.map(r => `${r.symbol} ${f(r.bubble)}`).join('، ')}`);
    if (lo.length) lines.push(`بیشترین تخفیف (معامله‌شده امروز): ${lo.map(r => `${r.symbol} ${f(r.bubble)}`).join('، ')}`);
    lines.push('حباب با قیمت پایانی و NAV ابطال آخرین اعلام صندوق حساب شده؛ ستون «تاریخ NAV» قدیمی بودن NAV را نشان می‌دهد.');
    return lines.join('\n');
  };

  // ============================================================ نرخ بهره‌ی واقعی
  // فیشر: واقعی = (۱ + اسمی) ÷ (۱ + تورم) − ۱. تورم را کاربر از گزارش ماهانه‌ی مرکز آمار وارد می‌کند (API رسمی ندارد).
  // inf = { basis: 'p2p' | 'avg12' | 'expected', expected, deposit_rate, entries: [{month: '1405/06', p2p, avg12, monthly}] }
  F.realRate = (nominalPct, inflationPct) => (nominalPct == null || inflationPct == null ? null : ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100);
  F.INF_BASIS = { p2p: 'تورم نقطه‌به‌نقطه (آخرین ماه)', avg12: 'تورم میانگین ۱۲ ماهه (آخرین ماه)', expected: 'تورم مورد انتظار خودت' };
  F.sortedInflation = inf => [...((inf || {}).entries || [])].filter(e => e && e.month).sort((a, b) => (a.month < b.month ? 1 : -1));
  const monthKey = m => { const [y, mm] = String(m).split('/'); return `${y}/${String(mm || '').padStart(2, '0')}`; };
  F.normMonth = m => { const x = U.digits(String(m || '')).trim().replace(/[-.]/g, '/'); return /^1[34]\d{2}\/\d{1,2}$/.test(x) ? monthKey(x) : null; };
  /** تورم مبنا: {v, label} یا null */
  F.inflationBasis = inf => {
    inf = inf || {};
    const basis = inf.basis || 'p2p';
    if (basis === 'expected') return inf.expected != null ? { v: inf.expected, label: F.INF_BASIS.expected } : null;
    const e = F.sortedInflation(inf).find(x => x[basis] != null);
    return e ? { v: e[basis], label: `${F.INF_BASIS[basis]} — ${e.month}` } : null;
  };
  /** items = [{name, nominal, note}] → با ستون real */
  F.realTable = (items, infPct) => items.filter(x => x.nominal != null).map(x => ({ ...x, inflation: infPct, real: F.realRate(x.nominal, infPct) }));
  F.realNote = (ytm, basis) => {
    if (!basis) return 'تورم وارد نشده؛ در تب «📉 نرخ بهره‌ی واقعی» تورم ماهانه‌ی مرکز آمار (یا تورم مورد انتظار خودت) را وارد کن.';
    if (ytm == null) return `تورم مبنا ${basis.v.toFixed(1)}٪ (${basis.label})؛ بازده اخزا در دسترس نیست.`;
    const r = F.realRate(ytm, basis.v), s = `${r >= 0 ? '+' : ''}${r.toFixed(1)}٪`;
    return `بازده واقعی اخزا ${s} (اسمی ${ytm.toFixed(1)}٪، تورم مبنا ${basis.v.toFixed(1)}٪ — ${basis.label}). ` +
      (r < -2 ? 'نرخ واقعی منفی است: نگه‌داشتن دارایی ریالی با سود ثابت قدرت خرید را کم می‌کند و معمولاً به نفع دارایی‌های واقعی (طلا، ارز، سهام، مسکن) است.'
        : r > 2 ? 'نرخ واقعی مثبت است: اوراق با سود ثابت از تورم جلوترند و رقیب جدی سهام و طلا هستند.'
          : 'نرخ واقعی نزدیک صفر است: اوراق تقریباً فقط قدرت خرید را حفظ می‌کنند.');
  };

  // ============================================================ تابلوی «پول کجا برود»
  // دو نگاه: (۱) بازده پیش‌رو = چیزی که امروز قفل می‌شود یا انتظار می‌رود؛ (۲) بازده گذشته = رشد واقعی هر دارایی از سابقه‌ی ذخیره‌شده.
  // ctx = { ytm, deposit, cc: [...], ccMinProt, eq: {market}, loans: [{name, eff}], inf: {v,label}|null, past: [{name, last, d30, d90, d365}] }
  F.whereMoney = ctx => {
    const inf = ctx.inf ? ctx.inf.v : null, real = n => F.realRate(n, inf);
    const fwd = [];
    const add = (name, nominal, risk, note) => { if (nominal != null && Number.isFinite(nominal)) fwd.push({ name, nominal, real: real(nominal), risk, note }); };
    add('اسناد خزانه (اخزا) — میانه', ctx.ytm, 'بدون ریسک', 'بازده تا سررسید قفل‌شده اگر تا سررسید نگه داری');
    add('سپرده‌ی بانکی', ctx.deposit, 'بدون ریسک', 'عددی که در تب «نرخ بهره‌ی واقعی» وارد کرده‌ای');
    const ccOk = (ctx.cc || []).filter(r => r.live && r.protection >= (ctx.ccMinProt ?? 5) && r.days >= 14 && r.ann_flat != null);
    if (ccOk.length) {
      add('کاورد کال — میانه‌ی قراردادهای مناسب', U.median(ccOk.map(r => r.ann_flat)), 'متوسط', `${ccOk.length} قرارداد با حاشیه‌ی امنیت ≥ ${ctx.ccMinProt ?? 5}٪؛ اگر قیمت سهم ثابت بماند`);
      add(`کاورد کال — بهترین (${ccOk[0].symbol})`, ccOk[0].ann_flat, 'متوسط', `پایه ${ccOk[0].underlying}، ${ccOk[0].days} روز، حاشیه‌ی امنیت ${ccOk[0].protection.toFixed(1)}٪`);
    }
    const m = (ctx.eq || {}).market || {};
    if (m.ep != null) {
      add('سهام — بازده سود بازار (E/P)', m.ep, 'بالا', 'بدون فرض رشد سود؛ حداقل بازده‌ی بلندمدت اگر سودها ثابت بمانند');
      if (inf != null) add('سهام — E/P با رشد سود هم‌اندازه‌ی تورم', (1 + m.ep / 100) * (1 + inf / 100) * 100 - 100, 'بالا', 'فرض: سود شرکت‌ها همپای تورم مبنا رشد کند (گوردون)');
    }
    fwd.sort((a, b) => b.nominal - a.nominal);
    const loans = (ctx.loans || []).filter(l => l.eff != null).sort((a, b) => a.eff - b.eff);
    const cost = loans.map(l => ({ name: `وام: ${l.name}`, nominal: l.eff, real: real(l.eff), risk: '—', note: 'هزینه‌ی مؤثر (نه بازده)؛ اگر از بازده‌های بالا کمتر است، وام گرفتن و سرمایه‌گذاری به‌صرفه است' }));
    const past = (ctx.past || []).filter(p => p.last != null).map(p => ({ ...p, real365: p.d365 != null && ctx.past12Inf != null ? F.realRate(p.d365, ctx.past12Inf) : null }));
    return { fwd, cost, past };
  };

  F.whereNote = (w, inf) => {
    const f = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}٪`);
    const lines = [];
    const safe = w.fwd.filter(x => x.risk === 'بدون ریسک')[0];
    if (safe) lines.push(`بهترین گزینه‌ی بدون ریسک: ${safe.name} با ${f(safe.nominal)} اسمی` + (safe.real != null ? ` (واقعی ${f(safe.real)})` : '') + '.');
    const risky = w.fwd.filter(x => x.risk !== 'بدون ریسک');
    if (safe && risky.length) lines.push('اضافه‌بازده‌ی گزینه‌های پرریسک نسبت به آن: ' + risky.map(x => `${x.name} ${f(x.nominal - safe.nominal)}`).join('، ') + '.');
    if (w.cost.length && safe) lines.push(`ارزان‌ترین وام ثبت‌شده: ${w.cost[0].name.replace('وام: ', '')} با هزینه‌ی ${f(w.cost[0].nominal)}؛ ${w.cost[0].nominal < safe.nominal ? 'از بازده بدون ریسک کمتر است (وام گرفتن و خرید اخزا هم سود دارد).' : 'از بازده بدون ریسک بیشتر است.'}`);
    const p30 = w.past.filter(p => p.d30 != null).sort((a, b) => b.d30 - a.d30);
    if (p30.length) lines.push(`در ۳۰ روز گذشته: ${p30.map(p => `${p.name} ${f(p.d30)}`).join('، ')}.`);
    else lines.push('بازده گذشته از سابقه‌ی همین داشبورد ساخته می‌شود؛ هنوز ۳۰ روز سابقه نیست. هر روز «اجرای کامل» را بزن تا پر شود.');
    if (!inf) lines.push('برای ستون «واقعی»، تورم را در تب «📉 نرخ بهره‌ی واقعی» وارد کن.');
    lines.push('بازده‌های پیش‌رو هم‌جنس نیستند: اخزا و سپرده قطعی‌اند، کاورد کال به ثابت ماندن سهم بستگی دارد و سهام فقط تخمین است. این تابلو برای مقایسه است، نه توصیه.');
    return lines.join('\n');
  };

  IM.Finance = F;
})(window.IM = window.IM || {});
