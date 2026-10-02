/* تحلیل هوشمند اخبار (کاملاً در مرورگر).
   ۱) قواعد اقتصادی (قابل توضیح): هر خبر روی ۶ بازار اثر جهت‌دار دارد.
   ۲) مدل خودآموز: رگرسیون لجستیک روی n-gram حروف (هش‌شده) که هر خبر را با واکنش واقعی بازار در روز بعد
      (تغییر شاخص کل و دلار) برچسب می‌زند. هرچه بیشتر اجرا کنی و اخبار بیشتری ذخیره شود، دقیق‌تر می‌شود.
      تا وقتی داده واقعی کم است، با برچسب قواعد گرم می‌شود و اعتمادش را صریح گزارش می‌کند.
   + تشخیص نماد: خبری که نام یا نماد یک شرکت را دارد به آن نماد وصل می‌شود. */
(function (IM) {
  const { U, Store } = IM;
  const NLP = {};
  NLP.ASSETS = ['بورس', 'دلار', 'طلا و سکه', 'نفت', 'مسکن', 'خودرو'];

  // [کلمات, اثر روی [بورس، دلار، طلا، نفت، مسکن، خودرو], برچسب]
  const RULES = [
    [['لغو تحریم', 'رفع تحریم', 'توافق هسته', 'احیای برجام', 'توافق ایران و آمریکا', 'کاهش تنش'], [2, -2, -2, 0, -1, -1], 'گشایش سیاسی'],
    [['تحریم جدید', 'تشدید تحریم', 'اسنپ بک', 'مکانیسم ماشه', 'شکست مذاکر', 'قطعنامه'], [-2, 2, 2, 0, 1, 1], 'ریسک تحریم'],
    [['حمله', 'جنگ', 'درگیری نظامی', 'تنش نظامی', 'پهپاد', 'موشک'], [-2, 2, 2, 1, 0, 1], 'ریسک ژئوپلیتیک'],
    [['کاهش نرخ بهره', 'کاهش سود بانکی', 'تزریق نقدینگی', 'کاهش نرخ سود'], [2, 1, 1, 0, 1, 1], 'سیاست پولی انبساطی'],
    [['افزایش نرخ بهره', 'افزایش سود بانکی', 'افزایش نرخ سود', 'انقباض', 'سقف رشد ترازنامه'], [-2, -1, -1, 0, -1, -1], 'سیاست پولی انقباضی'],
    [['حراج اوراق', 'انتشار اوراق', 'فروش اوراق'], [-1, 0, 0, 0, 0, 0], 'رقابت اوراق با سهام'],
    [['تورم', 'رشد نقدینگی', 'کسری بودجه', 'چاپ پول'], [1, 1, 1, 0, 1, 1], 'فشار تورمی'],
    [['افزایش قیمت نفت', 'رشد قیمت نفت', 'صعود نفت', 'افزایش صادرات نفت'], [1, -1, 0, 2, 0, 0], 'نفت قوی‌تر'],
    [['کاهش قیمت نفت', 'سقوط نفت', 'افت قیمت نفت', 'کاهش صادرات نفت'], [-1, 1, 0, -2, 0, 0], 'نفت ضعیف‌تر'],
    [['افزایش قیمت دلار', 'رشد دلار', 'دلار گران', 'جهش دلار', 'دلار ۹', 'دلار رکورد'], [1, 2, 2, 0, 1, 1], 'رشد ارز'],
    [['کاهش قیمت دلار', 'افت دلار', 'دلار ارزان', 'ریزش دلار'], [-1, -2, -2, 0, 0, -1], 'افت ارز'],
    [['قیمت‌گذاری دستوری', 'قیمت گذاری دستوری', 'سقف قیمت', 'عوارض صادرات', 'ممنوعیت صادرات'], [-2, 0, 0, 0, 0, 0], 'دخالت قیمتی'],
    [['افزایش قیمت خودرو', 'گرانی خودرو', 'افزایش قیمت کارخانه'], [0, 0, 0, 0, 0, 2], 'خودرو گران'],
    [['کاهش قیمت خودرو', 'واردات خودرو', 'ارزانی خودرو'], [0, 0, 0, 0, 0, -2], 'خودرو ارزان'],
    [['افزایش اجاره', 'گرانی مسکن', 'رشد قیمت مسکن'], [0, 0, 0, 0, 2, 0], 'مسکن گران'],
    [['رکود مسکن', 'کاهش معاملات مسکن', 'مالیات بر خانه خالی'], [0, 0, 0, 0, -2, 0], 'رکود مسکن'],
    [['ورود پول حقیقی', 'رشد شاخص', 'سبزپوشی', 'صف خرید', 'رکورد شاخص'], [2, 0, 0, 0, 0, 0], 'جو مثبت بورس'],
    [['خروج پول حقیقی', 'ریزش شاخص', 'افت شاخص', 'صف فروش', 'قرمزپوش'], [-2, 0, 0, 0, 0, 0], 'جو منفی بورس'],
    [['صندوق تثبیت', 'حمایت از بازار', 'حمایت از بورس'], [1, 0, 0, 0, 0, 0], 'حمایت دولتی'],
    [['افزایش سرمایه', 'سود سهام', 'تقسیم سود', 'افزایش فروش', 'رشد سود'], [1, 0, 0, 0, 0, 0], 'خبر شرکتی مثبت'],
    [['زیان', 'کاهش سود', 'کاهش فروش', 'توقف نماد'], [-1, 0, 0, 0, 0, 0], 'خبر شرکتی منفی'],
    [['افزایش قیمت طلا', 'رشد طلا', 'رکورد طلا', 'انس طلا رکورد'], [0, 0, 2, 0, 0, 0], 'طلا قوی'],
    [['کاهش قیمت طلا', 'افت طلا', 'ریزش طلا'], [0, 0, -2, 0, 0, 0], 'طلا ضعیف'],
  ];
  // قواعد انگلیسی برای خبرهای همسایگان و منطقه (با حروف کوچک مقایسه می‌شوند). ترتیب اثر مثل RULES: [بورس، دلار، طلا، نفت، مسکن، خودرو]
  const RULES_EN = [
    [['sanctions relief', 'lift sanctions', 'lifting sanctions', 'sanctions eased', 'ease sanctions', 'nuclear deal', 'nuclear agreement', 'de-escalation', 'ceasefire deal', 'ceasefire agreement', 'agree to ceasefire', 'agreed ceasefire', 'ceasefire takes effect', 'ceasefire holds', 'truce deal', 'agree truce', 'agreed truce', 'reach truce', 'talks resume', 'breakthrough in talks'], [2, -2, -2, 0, -1, -1], 'گشایش سیاسی'],
    [['new sanctions', 'fresh sanctions', 'tighten sanctions', 'imposes sanctions', 'impose sanctions', 'snapback', 'talks collapse', 'talks stall', 'talks break down'], [-2, 2, 2, 0, 1, 1], 'ریسک تحریم'],
    [['airstrike', 'air strike', 'missile', 'drone attack', 'military escalation', 'tanker seized', 'strait of hormuz closure', 'clashes', 'retaliat', 'war on', 'war in'], [-2, 2, 2, 1, 0, 1], 'ریسک ژئوپلیتیک'],
    [['rate cut', 'cuts rates', 'cut interest rates', 'lowers rates'], [2, 1, 1, 0, 1, 1], 'سیاست پولی انبساطی'],
    [['rate hike', 'raises rates', 'hikes rates', 'raises interest rates'], [-2, -1, -1, 0, -1, -1], 'سیاست پولی انقباضی'],
    [['inflation rises', 'inflation surges', 'inflation hits', 'budget deficit', 'money printing'], [1, 1, 1, 0, 1, 1], 'فشار تورمی'],
    [['oil prices rise', 'oil rises', 'oil surges', 'oil jumps', 'oil climbs', 'oil rallies', 'crude rises', 'crude climbs', 'brent rises', 'brent climbs', 'brent jumps', 'opec cuts', 'output cut', 'supply cut', 'oil exports rise', 'oil exports increase'], [1, -1, 0, 2, 0, 0], 'نفت قوی‌تر'],
    [['oil prices fall', 'oil falls', 'oil slumps', 'oil drops', 'oil tumbles', 'oil slides', 'crude falls', 'crude slumps', 'brent falls', 'brent slides', 'opec raises output', 'opec boosts output', 'oil exports fall', 'oil exports drop'], [-1, 1, 0, -2, 0, 0], 'نفت ضعیف‌تر'],
    [['rial plunges', 'rial falls', 'rial record low', 'rial hits record low', 'rial weakens', 'lira plunges', 'lira falls', 'lira weakens'], [1, 2, 2, 0, 1, 1], 'رشد ارز'],
    [['rial rebounds', 'rial gains', 'rial strengthens', 'lira rebounds', 'lira gains'], [-1, -2, -2, 0, 0, -1], 'افت ارز'],
    [['gold rises', 'gold surges', 'gold rallies', 'gold hits record', 'gold climbs', 'gold jumps'], [0, 0, 2, 0, 0, 0], 'طلا قوی'],
    [['gold falls', 'gold slips', 'gold drops', 'gold slides', 'gold tumbles'], [0, 0, -2, 0, 0, 0], 'طلا ضعیف'],
    [['export ban', 'price cap', 'price controls'], [-2, 0, 0, 0, 0, 0], 'دخالت قیمتی'],
  ];
  const NEG = ['عدم', 'بدون', 'نه ', 'تکذیب', 'رد شد', 'منتفی'];
  const NEG_EN = /\b(denies|denied|deny|rules out|ruled out|no plans?|unlikely|fails? to)\b/;

  const norm = t => String(t || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
  NLP.normalize = norm;

  NLP.ruleImpact = title => {
    const t = norm(title), v = new Array(NLP.ASSETS.length).fill(0), why = [];
    for (const [kws, eff, label] of RULES) {
      if (!kws.some(k => t.includes(k))) continue;
      const sign = NEG.some(n => t.includes(n)) ? -1 : 1;
      eff.forEach((e, i) => { v[i] += sign * e; });
      why.push(sign > 0 ? label : `نفیِ «${label}»`);
    }
    const tl = t.toLowerCase();
    if (/[a-z]{3}/.test(tl)) for (const [kws, eff, label] of RULES_EN) {
      if (!kws.some(k => tl.includes(k))) continue;
      const sign = NEG_EN.test(tl) ? -1 : 1;
      eff.forEach((e, i) => { v[i] += sign * e; });
      why.push(sign > 0 ? label : `نفیِ «${label}»`);
    }
    return [v.map(x => Math.max(-3, Math.min(3, x))), why];
  };

  NLP.linkSymbols = (title, names) => {
    const t = norm(title), words = new Set(t.match(/[\p{L}\p{N}_]+/gu) || []), hits = [];
    for (const [sym, nm] of Object.entries(names)) {
      if (sym.length >= 3 && words.has(sym)) hits.push(sym);
      else if (nm && nm.length >= 8 && t.includes(nm)) hits.push(sym);
    }
    return hits.slice(0, 5);
  };

  // ============================================================ مدل خودآموز
  const DIM = 1 << 15;
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % DIM; };
  /** بردار تُنُک TF (sublinear) با n-gram حروف ۲ تا ۴ داخل کلمه، نرمال‌شده L2 */
  function featurize(title) {
    const tf = new Map();
    for (const w of norm(title).split(' ')) {
      const p = ` ${w} `;
      for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= p.length; i++) { const k = hash(p.slice(i, i + n)); tf.set(k, (tf.get(k) || 0) + 1); }
    }
    let norm2 = 0; const idx = [], val = [];
    for (const [k, c] of tf) { const v = 1 + Math.log(c); idx.push(k); val.push(v); norm2 += v * v; }
    const z = Math.sqrt(norm2) || 1;
    return { idx, val: val.map(v => v / z) };
  }
  const dot = (w, b, x) => { let s = b; for (let i = 0; i < x.idx.length; i++) s += w[x.idx[i]] * x.val[i]; return s; };
  const sigmoid = z => 1 / (1 + Math.exp(-z));

  function trainLogistic(X, y, sw, epochs = 25, lr = 0.8, l2 = 1e-4) {
    const w = new Float32Array(DIM); let b = 0;
    const order = X.map((_, i) => i);
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let e = 0; e < epochs; e++) {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const i of order) {
        const g = (sigmoid(dot(w, b, X[i])) - y[i]) * sw[i] * lr / (1 + e * 0.2);
        const x = X[i];
        for (let k = 0; k < x.idx.length; k++) w[x.idx[k]] -= g * x.val[k] + l2 * w[x.idx[k]];
        b -= g;
      }
    }
    return { w, b };
  }

  class NewsBrain {
    constructor() { this.models = {}; this.info = {}; }
    labeled() {
      const rows = Store.get('news', []), X = [], real = [], rule = [], nextChange = Store.nextChangeFn();
      for (const n of rows) {
        const r = n.rule && n.rule.length ? n.rule : [0, 0, 0, 0, 0, 0];
        const ch = ['tedpix', 'usd_irr'].map(k => nextChange(k, n.d));
        X.push(n.title);
        rule.push([Math.sign(r[0]), Math.sign(r[1])]);
        real.push(ch.map(c => c != null && Math.abs(c) > 0.3 ? Math.sign(c) : NaN));
      }
      return { X, real, rule };
    }
    train() {
      const { X, real, rule } = this.labeled();
      if (X.length < 40) { this.info = { status: `داده کافی نیست (${X.length} خبر ذخیره‌شده؛ حداقل ۴۰)` }; return this.info; }
      const F = X.map(featurize);
      ['بورس', 'دلار'].forEach((target, j) => {
        const y = [], idx = [], sw = [], isReal = [];
        X.forEach((_, i) => {
          const hasReal = !Number.isNaN(real[i][j]);
          const lab = hasReal ? real[i][j] : rule[i][j];
          if (lab === 0) return;
          idx.push(i); y.push(lab > 0 ? 1 : 0); sw.push(hasReal ? 3 : 1); isReal.push(hasReal);   // برچسب واقعی بازار وزن ۳
        });
        const nReal = isReal.filter(Boolean).length;
        if (idx.length < 30 || new Set(y).size < 2) { this.info[target] = { status: 'برچسب کافی نیست', real_labels: nReal }; return; }
        const m = trainLogistic(idx.map(i => F[i]), y, sw);
        let acc = null;
        if (nReal >= 30) { let ok = 0, n = 0; idx.forEach((i, k) => { if (isReal[k]) { n++; if ((sigmoid(dot(m.w, m.b, F[i])) > 0.5 ? 1 : 0) === y[k]) ok++; } }); acc = ok / n; }
        this.models[target] = m;
        this.info[target] = { samples: idx.length, real_labels: nReal, train_acc_on_real: acc != null ? U.round(acc, 2) : null,
          trust: nReal >= 500 ? 'بالا' : nReal >= 150 ? 'متوسط' : 'پایین (هنوز بیشتر از قواعد تقلید می‌کند)' };
      });
      return this.info;
    }
    predict(titles) {
      const out = {}, F = titles.map(featurize);
      for (const [k, m] of Object.entries(this.models)) out[k] = F.map(x => 2 * sigmoid(dot(m.w, m.b, x)) - 1);   // بین -۱ و +۱
      return out;
    }
  }

  // ============================================================ اجرای کامل
  NLP.analyze = (items, symbolNames, today) => {
    for (const it of items) {
      const [v, why] = NLP.ruleImpact(it.title);
      it.impact = v; it.why = why; it.symbols = NLP.linkSymbols(it.title, symbolNames);
    }
    Store.saveNews(items, today);
    const brain = new NewsBrain();
    const info = brain.train();
    const titles = items.map(i => i.title);
    const nn = titles.length ? brain.predict(titles) : {};
    items.forEach((it, i) => { it.nn = {}; for (const [k, v] of Object.entries(nn)) it.nn[k] = U.round(v[i], 2); });

    const active = items.filter(it => it.impact.some(x => x !== 0));
    const agg = {};
    NLP.ASSETS.forEach((a, j) => { agg[a] = active.length ? U.round(U.mean(active.map(it => it.impact[j])), 2) : 0; });
    const nnAgg = {};
    for (const [k, v] of Object.entries(nn)) nnAgg[k] = U.round(U.mean(v), 2);
    const themes = {}, bySymbol = {};
    for (const it of items) {
      it.why.forEach(w => { themes[w] = (themes[w] || 0) + 1; });
      it.symbols.forEach(s => { (bySymbol[s] = bySymbol[s] || []).push(it.title); });
    }
    const sortedThemes = Object.fromEntries(Object.entries(themes).sort((a, b) => b[1] - a[1]));
    return { impact: agg, nn: nnAgg, nn_info: info, themes: sortedThemes, by_symbol: bySymbol, n: items.length, n_relevant: active.length };
  };

  IM.NLP = NLP;
})(window.IM = window.IM || {});
