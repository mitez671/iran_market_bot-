/* رابط کاربری: دریافت داده (بدون VPN / با VPN)، اجرای کامل از داده‌های جمع‌شده، تب «سایت‌ها و VPN»، تنظیمات، حالت خودکار. */
(function (IM) {
  const { U, Net, Store, Cycle, Collect, Dashboard } = IM;
  const $ = id => document.getElementById(id);
  const esc = U.escapeHtml;
  const CFG_KEY = 'imcfg';                       // خارج از ns تا «پاک‌کردن داده‌ها» تنظیمات را نبرد
  const SRC_TAB = 'tsrc';
  let cfg, running = false, auto = false, autoTimer = null, lastPrompt = '', activeTab = 't0';
  let bundle = { sources: {} };                  // داده‌های خام جمع‌شده
  let curView = null, curMeta = null, cfgDirty = false;

  // ---------------------------------------------------------------- تنظیمات
  const isObj = U.isObj, merge = U.merge;
  function loadConfig() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { /* ignore */ }
    // مهاجرت: نسخه‌های قدیمی کل تنظیمات را ذخیره می‌کردند و فهرست قدیمی سایت‌های خبری (بدون فیلد region) فهرست جدید را می‌پوشاند
    const ns = saved.news && saved.news.sites;
    if (Array.isArray(ns) && !ns.some(x => x && x.region)) { delete saved.news.sites; if (!Object.keys(saved.news).length) delete saved.news; }
    cfg = merge(IM.DEFAULT_CONFIG, saved);
  }
  /** فقط تفاوت با پیش‌فرض ذخیره می‌شود؛ هم در مرورگر و هم (اگر سرور وصل باشد) در فایلی روی خود گوشی */
  function saveConfig(c) {
    cfg = merge(IM.DEFAULT_CONFIG, c);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(U.diff(IM.DEFAULT_CONFIG, cfg))); localStorage.setItem(CFG_PENDING, '1'); } catch (e) { /* ignore */ }
    pushSettings();
  }

  // ---------------------------------------------------------------- نسخه‌ی پشتیبان تنظیمات روی سرور ترموکس
  // localStorage به آدرس صفحه بسته است (پورت دیگر یا پاک شدن داده‌های مرورگر = تنظیمات از دست می‌رود)؛
  // برای همین تنظیمات در ~/.iran_market_dashboard/settings.json هم نگه داشته می‌شود. کلید API و توکن‌ها (llm، notify) آنجا نمی‌روند.
  const CFG_PENDING = 'imcfg_pending';           // تغییری که هنوز به سرور نرسیده
  const serverPart = () => { const { llm, notify, ...rest } = U.diff(IM.DEFAULT_CONFIG, cfg); return rest; };
  async function pushSettings() {
    if (!serverUp) return;
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverPart()) });
      if (r.ok) try { localStorage.removeItem(CFG_PENDING); } catch (e) { /* ignore */ }
    } catch (e) { /* بعداً دوباره */ }
  }
  let synced = false;
  /** یک‌بار بعد از وصل شدن به سرور: اگر تغییر نفرستاده‌ای داریم، می‌فرستیم؛ وگرنه تنظیمات ذخیره‌شده روی گوشی را می‌خوانیم */
  async function syncSettings() {
    if (synced || !serverUp) return;
    synced = true;
    let pending = false; try { pending = !!localStorage.getItem(CFG_PENDING); } catch (e) { /* ignore */ }
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      const saved = r.ok ? await r.json() : null;
      if (pending || !isObj(saved)) return pushSettings();
      const { llm, notify } = U.diff(IM.DEFAULT_CONFIG, cfg);    // بخش محرمانه فقط در همین مرورگر است
      cfg = merge(IM.DEFAULT_CONFIG, { ...saved, ...(llm ? { llm } : {}), ...(notify ? { notify } : {}) });
      try { localStorage.setItem(CFG_KEY, JSON.stringify(U.diff(IM.DEFAULT_CONFIG, cfg))); } catch (e) { /* ignore */ }
      updateCounts(); refreshSources(); refreshLoans(); refreshReal();
      if ($('dlg').open) { if (!cfgDirty) $('cfgText').value = JSON.stringify(cfg, null, 2); renderSources($('srcBox')); }
    } catch (e) { synced = false; }
  }

  // ---------------------------------------------------------------- IndexedDB (آخرین نتیجه و داده‌های جمع‌شده)
  const idb = {
    db: null,
    open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const q = indexedDB.open('iran-market', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(this.db = q.result); q.onerror = () => rej(q.error); }); },
    async get(k) { try { const db = await this.open(); return await new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; } },
    async set(k, v) { try { const db = await this.open(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { /* ignore */ } },
  };

  // ---------------------------------------------------------------- UI
  const logEl = () => $('log');
  const origWarn = console.warn;
  console.warn = (...a) => { origWarn.apply(console, a); const el = logEl(); if (el) { el.textContent += a.map(String).join(' ') + '\n'; el.scrollTop = el.scrollHeight; } };
  const setMsg = t => { $('msg').textContent = t; };
  const setProgress = f => { $('progress').firstElementChild.style.width = Math.round(f * 100) + '%'; };
  function fixStickyOffset() { document.documentElement.style.setProperty('--hh', $('top').offsetHeight + 'px'); }
  function setRunning(v) { running = v; ['run', 'demo', 'collectNo', 'collectVpn', 'full'].forEach(id => { $(id).disabled = v; }); fixStickyOffset(); }

  // ---------------------------------------------------------------- انتخاب سایت‌ها برای هر دکمه (تب «سایت‌ها و VPN» و ⚙ تنظیمات)
  let srcQuery = '', srcFilter = 'all';
  const countOf = g => Collect.list(cfg).filter(s => Collect.modeOf(cfg, s.id) === g).length;
  function updateCounts() {
    $('collectNo').textContent = `🌐 دانلود بدون VPN (${countOf('novpn')})`;
    $('collectVpn').textContent = `🔒 دانلود با VPN (${countOf('vpn')})`;
  }
  function applyModes(ids, mode) {
    const c = JSON.parse(JSON.stringify(cfg)); c.source_modes = c.source_modes || {};
    ids.forEach(id => { if (mode && mode !== Collect.defaultMode(c, id)) c.source_modes[id] = mode; else delete c.source_modes[id]; });
    saveConfig(c); updateCounts();
    if ($('dlg').open && !cfgDirty) $('cfgText').value = JSON.stringify(cfg, null, 2);
  }

  function renderSources(el) {
    el.innerHTML = `<div class="card"><h3>سایت‌ها و دکمه‌ی دانلودشان</h3>
      <p class="mut">پیش‌فرض: سایت‌های ایرانی <b>بدون VPN</b> و سایت‌های خارجی <b>با VPN</b>. هر کدام را خواستی عوض کن؛ انتخابت همان لحظه ذخیره می‌شود
      (در مرورگر و در فایل تنظیمات روی گوشی) و دفعه‌ی بعد لازم نیست دوباره بزنی. <b>«دانلود بدون VPN»</b> فقط سایت‌های «بدون VPN» را می‌گیرد و <b>«دانلود با VPN»</b> فقط سایت‌های «با VPN» را؛
      VPN گوشی را خودت قبل از زدن هر دکمه روشن یا خاموش کن. سایت‌های «غیرفعال» در هیچ‌کدام گرفته نمی‌شوند. در آخر «اجرای کامل از داده‌های جمع‌شده» را بزن.
      اگر دریافت یک سایت شکست بخورد، داده‌ی قبلیِ همان سایت می‌ماند.</p>
      <p class="chips"></p>
      <div class="tools"><input class="q srcQ" placeholder="جستجوی سایت…" aria-label="جستجو" value="${esc(srcQuery)}">
        <select class="q srcF" aria-label="فیلتر"><option value="all">همه</option><option value="custom">تغییرداده‌شده توسط من</option><option value="fail">ناموفق در آخرین دریافت</option></select>
        <span class="mut cnt"></span></div>
      <div class="row" style="margin:0 0 10px"><span class="mut">همه‌ی ردیف‌های نمایش‌داده‌شده ←</span>
        <button class="act" data-bulk="novpn">بدون VPN</button><button class="act" data-bulk="vpn">با VPN</button>
        <button class="act" data-bulk="off">غیرفعال</button><button class="act" data-bulk="">برگرداندن به پیش‌فرض</button></div>
      <div class="tw"><table><thead><tr><th>سایت</th><th>آدرس</th><th>دسته</th><th>وضعیت آخرین دریافت</th></tr></thead><tbody></tbody></table></div></div>`;
    const q = el.querySelector('.srcQ'), f = el.querySelector('.srcF'), body = el.querySelector('tbody'), chips = el.querySelector('.chips'), cnt = el.querySelector('.cnt');
    f.value = srcFilter;
    const chip = () => {
      const all = Collect.list(cfg), c = m => all.filter(s => Collect.modeOf(cfg, s.id) === m).length;
      chips.innerHTML = `<span class="chip">بدون VPN: ${c('novpn')}</span> <span class="chip">با VPN: ${c('vpn')}</span> <span class="chip">غیرفعال: ${c('off')}</span> <span class="chip">تغییرداده‌شده: ${all.filter(s => Collect.isCustom(cfg, s.id)).length}</span>`;
    };
    let shown = [];
    const draw = () => {
      shown = Collect.summary(cfg, bundle).filter(r => (!srcQuery || (r.label + ' ' + r.host).toLowerCase().includes(srcQuery.toLowerCase())) &&
        (srcFilter === 'all' || (srcFilter === 'custom' && r.custom) || (srcFilter === 'fail' && r.state === 'fail')));
      cnt.textContent = ` ${shown.length} سایت`;
      body.innerHTML = shown.map(r => `<tr class="${r.state === 'fail' ? 'sell' : ''}"><td class="w">${esc(r.label)}</td><td dir="ltr">${esc(r.host)}</td>
        <td><select class="q" data-id="${esc(r.id)}" aria-label="دسته‌ی ${esc(r.label)}">${Object.entries(Collect.MODES).map(([k, v]) => `<option value="${k}"${k === r.mode ? ' selected' : ''}>${v}</option>`).join('')}</select>${r.custom ? ' ✎' : ''}</td>
        <td class="w">${r.state === 'ok' ? '✅' : r.state === 'fail' ? '❌' : '⚪'} ${esc(r.msg)}${r.t ? ' — ' + esc(r.t.replace('T', ' ')) : ''}</td></tr>`).join('');
      body.querySelectorAll('select[data-id]').forEach(s => { s.onchange = () => { applyModes([s.dataset.id], s.value); chip(); }; });
    };
    q.oninput = () => { srcQuery = q.value.trim(); draw(); };
    f.onchange = () => { srcFilter = f.value; draw(); };
    el.querySelectorAll('[data-bulk]').forEach(b => { b.onclick = () => { applyModes(shown.map(r => r.id), b.dataset.bulk); chip(); draw(); }; });
    chip(); draw();
  }
  const refreshSources = () => { const el = document.querySelector(`[data-x="${SRC_TAB}"]`); if (el) renderSources(el); };

  // ---------------------------------------------------------------- تب «تسهیلات بانکی»: طرح‌های وام با سپرده و نرخ مؤثرشان
  const LOAN_TAB = 'tloan', F = IM.Finance;
  let loanEdit = -1;                               // شماره‌ی طرحی که در فرم ویرایش می‌شود (-۱ = طرح جدید)
  let loanDraft = null;                            // پیش‌نویس فرم (از «ویرایش و افزودن» یک طرح استخراج‌شده)
  const loanCands = {};                            // طرح‌های استخراج‌شده با Claude یا متن پیست‌شده: {bank: [plans]}
  const pastedText = {};                           // متن‌هایی که کاربر پیست کرده: {bank: text}
  let claudeBank = '';                             // بانکی که پرامپت دستی Claude برایش ساخته شده
  const numIn = v => { const n = U.toNum(String(v).replace(/٫/g, '.')); return n == null ? null : n; };
  /** بازده جایگزین سپرده (درصد سالانه) و منبعش */
  /** میانه بازده اخزا از آخرین دیده‌بان جمع‌شده (یا null) */
  function benchYtm() {
    const mw = ((bundle.sources || {}).tsetmc_watch || {}).data;
    if (!Array.isArray(mw) || !mw.length) return null;
    try { return IM.Tsetmc.bondTable(mw, U.tehranNow().date).benchmark || null; } catch (e) { return null; }
  }
  function altRate() {
    const a = (cfg.loans || {}).alt_rate;
    if (typeof a === 'number') return { v: a, src: 'عدد واردشده' };
    const b = benchYtm();
    if (b) return { v: b, src: 'میانه بازده اخزا از آخرین دیده‌بان' };
    const br = cfg.benchmark_rate;
    return typeof br === 'number' ? { v: br * 100, src: 'benchmark_rate تنظیمات' } : { v: 35, src: 'پیش‌فرض (هنوز دیده‌بان TSETMC دریافت نشده)' };
  }
  function saveLoans(patch) { const c = JSON.parse(JSON.stringify(cfg)); c.loans = { ...(c.loans || {}), ...patch }; saveConfig(c); refreshReal(); }

  function renderLoans(el) {
    const plans = (cfg.loans || {}).plans || [], alt = altRate(), cur = loanEdit >= 0 ? plans[loanEdit] || {} : loanDraft || {};
    const fmt = (v, d = 1) => v == null || !Number.isFinite(v) ? '—' : U.fmt(v, d);
    const rows = plans.map((p, i) => ({ p, i, r: F.loanCalc(p, alt.v) }));
    el.innerHTML = `<div class="card"><h3>نرخ مؤثر تسهیلات با سپرده‌گذاری</h3>
      <p class="mut">پولی که برای گرفتن وام در بانک می‌خوابانی می‌توانست جای دیگری سود بگیرد. این هزینه‌ی فرصت از مبلغ وام کم می‌شود و بعد نرخ واقعی اقساط (IRR) حساب می‌شود.
      <b>نرخ مؤثر</b> یعنی این وام در عمل با چه نرخ سالانه‌ای برایت تمام می‌شود. اگر از بازده جایگزین کمتر باشد، گرفتن وام به‌صرفه است.
      مبلغ‌ها را در هر واحدی وارد کن، فقط یکسان باشند (پیش‌فرض میلیون تومان). طرح‌ها ذخیره می‌شوند.</p>
      <div class="tools"><label>بازده جایگزین سپرده (٪ سالانه):
        <input class="q" id="loanAlt" style="width:90px" value="${esc(typeof (cfg.loans || {}).alt_rate === 'number' ? cfg.loans.alt_rate : 'auto')}"></label>
        <span class="mut">الان: <b>${fmt(alt.v)}٪</b> — ${esc(alt.src)}. «auto» یعنی خودکار از اخزا.</span></div></div>
      <div class="card"><h3>${loanEdit >= 0 ? 'ویرایش طرح' : 'افزودن طرح'}</h3><div class="fgrid">
        ${F.PLAN_FIELDS.map(([k, lab, t]) => `<label>${esc(lab)}<input class="q" data-k="${k}" ${t === 'num' ? 'inputmode="decimal"' : ''} value="${esc(cur[k] ?? '')}"></label>`).join('')}
        </div><div class="tools"><button class="act primary" id="loanSave">${loanEdit >= 0 ? 'ذخیره‌ی تغییرات' : 'افزودن'}</button>
        <button class="act" id="loanClear">${loanEdit >= 0 ? 'انصراف' : 'پاک کردن فرم'}</button><span class="mut" id="loanPrev"></span></div></div>
      <div id="loanAuto"></div>
      <div class="card"><h3>طرح‌ها (${plans.length})</h3>${plans.length ? `<div class="tw"><table><tr><th>بانک</th><th>طرح</th><th>سپرده</th><th>وام</th><th>وام/سپرده</th><th>نرخ اسمی٪</th>
        <th>اقساط</th><th>قسط ماهانه</th><th>هزینه‌ی فرصت سپرده</th><th>وام خالص</th><th>نرخ مؤثر٪</th><th>نتیجه</th><th></th></tr>
        ${[...rows].sort((a, b) => (a.r.eff ?? 1e9) - (b.r.eff ?? 1e9)).map(({ p, i, r }) => `<tr class="${r.eff != null && r.eff < alt.v - 2 ? 'buy' : r.error || r.eff == null || r.eff > alt.v + 2 ? 'sell' : ''}">
          <td>${esc(p.bank || '')}</td><td class="w">${esc(p.name || '')}${p.auto ? ` <span class="chip">${esc(p.auto)}</span>` : ''}${U.safeUrl(p.url) ? ` <a href="${esc(U.safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">صفحه</a>` : ''}${p.note ? `<div class="mut" style="font-size:11px">${esc(p.note)}</div>` : ''}</td><td>${fmt(p.deposit, 0)}</td><td>${fmt(p.loan, 0)}</td><td>${fmt(r.ratio, 2)}</td><td>${fmt(p.rate)}</td>
          <td>${fmt(p.months, 0)}</td><td>${fmt(r.pmt, 2)}</td><td>${fmt(r.cost, 1)}</td><td>${fmt(r.net, 1)}</td><td><b>${fmt(r.eff)}</b></td><td class="w">${esc(r.error || r.verdict)}</td>
          <td><button class="act" data-ed="${i}">ویرایش</button> <button class="act" data-cp="${i}">کپی</button> <button class="act" data-del="${i}">حذف</button></td></tr>`).join('')}</table></div>`
        : '<p class="mut">هنوز طرحی وارد نشده. مشخصات طرح را از سایت بانک بردار و در فرم بالا وارد کن.</p>'}
      <details><summary>روش محاسبه</summary><pre>i = بازده جایگزین ماهانه، D = سپرده، W = ماه‌های انتظار، b = سهم مسدود، n = اقساط
هزینه‌ی فرصت در روز گرفتن وام = D×(1+i)^W − سود سپرده‌ی دوره‌ی انتظار − D×(1−b) − ارزش فعلی (سپرده‌ی مسدود + سودش) که پایان اقساط برمی‌گردد
وام خالص = وام × (1 − کارمزد) − هزینه‌ی فرصت
نرخ مؤثر = نرخی که ارزش فعلی n قسط را برابر «وام خالص» کند (سالانه‌ی مرکب)</pre></details></div>`;
    const read = () => { const p = {}; el.querySelectorAll('[data-k]').forEach(x => { const f = F.PLAN_FIELDS.find(q => q[0] === x.dataset.k);
      const v = x.value.trim(); if (v === '') return; p[x.dataset.k] = f[2] === 'num' ? numIn(v) : v; }); return p; };
    const preview = () => { const r = F.loanCalc(read(), alt.v); el.querySelector('#loanPrev').textContent = r.error ? r.error
      : `قسط ${fmt(r.pmt, 2)} — نرخ مؤثر ${fmt(r.eff)}٪ — ${r.verdict}`; };
    el.querySelectorAll('[data-k]').forEach(x => { x.oninput = preview; });
    preview();
    el.querySelector('#loanAlt').onchange = e => { const v = e.target.value.trim(), n = numIn(v);
      saveLoans({ alt_rate: !v || /^auto$/i.test(v) || n == null ? 'auto' : n }); renderLoans(el); };
    el.querySelector('#loanSave').onclick = () => {
      const src = loanEdit >= 0 ? plans[loanEdit] || {} : loanDraft || {}, p = read(), r = F.loanCalc(p, alt.v);
      ['url', 'note', 'auto'].forEach(k => { if (src[k]) p[k] = src[k]; });            // لینک و متن منبع طرح استخراج‌شده می‌ماند
      if (r.error) { el.querySelector('#loanPrev').textContent = r.error; return; }
      const list = [...plans]; if (loanEdit >= 0) list[loanEdit] = p; else list.push(p);
      loanEdit = -1; loanDraft = null; saveLoans({ plans: list }); renderLoans(el);
    };
    el.querySelector('#loanClear').onclick = () => { loanEdit = -1; loanDraft = null; renderLoans(el); };
    renderLoanAuto(el.querySelector('#loanAuto'), () => renderLoans(el), alt, plans, d => { loanEdit = -1; loanDraft = d; renderLoans(el); el.scrollIntoView(); });
    el.querySelectorAll('[data-ed]').forEach(b => { b.onclick = () => { loanEdit = +b.dataset.ed; renderLoans(el); el.scrollIntoView(); }; });
    el.querySelectorAll('[data-cp]').forEach(b => { b.onclick = () => { const p = { ...plans[+b.dataset.cp] }; p.name = (p.name || '') + ' (کپی)'; saveLoans({ plans: [...plans, p] }); renderLoans(el); }; });
    el.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { const p = plans[+b.dataset.del];
      if (!confirm(`طرح «${p.bank || ''} ${p.name || ''}» حذف شود؟`)) return;
      loanEdit = -1; saveLoans({ plans: plans.filter((_, j) => j !== +b.dataset.del) }); renderLoans(el); }; });
  }

  /** کارت «دریافت خودکار طرح‌ها»: آدرس صفحه‌ی بانک‌ها، استخراج با الگو و Claude، پیشنهادها برای تأیید */
  function renderLoanAuto(box, rerender, alt, plans, toForm) {
    const L = cfg.loans || {}, srcs = L.sources || [], llm = cfg.llm || {}, api = llm.mode === 'api' && !!llm.api_key;
    const fmt = (v, d = 1) => v == null || !Number.isFinite(v) ? '—' : U.fmt(v, d);
    const pageText = bank => pastedText[bank] || (((bundle.sources || {})['loanpage:' + bank] || {}).data || {}).text || '';
    const banks = [...new Set([...srcs.map(x => x.bank), ...Object.keys(pastedText)])].filter(b => pageText(b));
    // پیشنهادها: Claude (اگر گرفته شده) وگرنه الگو
    const cands = [];
    const radeSrc = (bundle.sources || {}).rade, rade = (radeSrc && radeSrc.data && radeSrc.data.plans) || [];
    rade.forEach(p => cands.push(p));
    for (const b of banks) (loanCands[b] || F.parseLoanText(pageText(b), b)).forEach(p => cands.push(p));
    const sig = p => [p.bank, p.deposit, p.loan, p.rate, p.months, p.wait].join('|');
    const have = new Set(plans.map(sig));
    const st = bank => { const x = (bundle.sources || {})['loanpage:' + bank];
      return !x ? '⚪ هنوز دریافت نشده' : x.ok ? `✅ ${x.msg}${x.t ? ' — ' + x.t.replace('T', ' ') : ''}` : `❌ ${x.msg}`; };
    box.innerHTML = `<div class="card"><h3>دریافت خودکار طرح‌ها از سایت بانک‌ها</h3>
      <p class="mut"><b>rade.ir:</b> وام‌های با مسدودی سپرده${(L.rade || {}).active_only === false ? '' : ' (فقط فعال)'} از سایت رده با هر «دانلود بدون VPN» گرفته می‌شوند —
      ${radeSrc ? (radeSrc.ok ? `✅ ${esc(radeSrc.msg)}${radeSrc.t ? ' — ' + esc(radeSrc.t.replace('T', ' ')) : ''}` : `❌ ${esc(radeSrc.msg)}`) : '⚪ هنوز دریافت نشده'}.
      <label><input type="checkbox" id="radeAll"${(L.rade || {}).active_only === false ? ' checked' : ''}> وام‌های منقضی‌شده هم بیاید</label>
      <label><input type="checkbox" id="radeOff"${(L.rade || {}).enabled === false ? ' checked' : ''}> rade را نگیر</label></p>
      <p class="mut">آدرس صفحه‌ی طرح‌های تسهیلات هر بانک را یک بار اضافه کن. هر بار «دانلود بدون VPN» را بزنی، صفحه‌ها هم گرفته می‌شوند (دسته‌شان در تب «سایت‌ها و VPN» قابل تغییر است).
      طرح‌ها اول با <b>الگوی ساده</b> تشخیص داده می‌شوند (تقریبی). برای دقت بیشتر «استخراج با Claude» را بزن${api ? '' : ' (حالت دستی: پرامپت را در اپ Claude بزن و جوابش را برگردان)'}.
      هر پیشنهاد را قبل از افزودن چک کن. اگر صفحه عکس یا PDF است، متنش را دستی پیست کن.</p>
      <div class="fgrid"><label>نام بانک<input class="q" id="laBank"></label><label>آدرس صفحه‌ی طرح‌ها<input class="q" id="laUrl" dir="ltr" placeholder="https://..."></label></div>
      <div class="tools"><button class="act" id="laAdd">افزودن صفحه</button><span class="mut" id="laMsg"></span></div>
      ${srcs.length ? `<div class="tw"><table><tr><th>بانک</th><th>آدرس</th><th>آخرین دریافت</th><th></th></tr>${srcs.map((x, i) => `<tr><td>${esc(x.bank)}</td><td dir="ltr" class="w">${esc(x.url)}</td>
        <td class="w">${esc(st(x.bank))}</td><td><button class="act" data-lsdel="${i}">حذف</button></td></tr>`).join('')}</table></div>` : ''}
      <details><summary>پیست کردن متن صفحه (برای صفحه‌های عکسی، PDF یا جاوااسکریپتی)</summary>
        <div class="fgrid"><label>نام بانک<input class="q" id="lpBank"></label></div><textarea class="q" id="lpText" rows="5" style="width:100%;box-sizing:border-box" placeholder="متن طرح‌ها را اینجا پیست کن"></textarea>
        <div class="tools"><button class="act" id="lpGo">استخراج از این متن</button></div></details>
      ${banks.length ? `<div class="tools"><b>Claude:</b> <select class="q" id="lcBank">${banks.map(b => `<option${b === claudeBank ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        ${api ? '<button class="act primary" id="lcApi">استخراج با Claude</button><button class="act" id="lcApiAll">همه‌ی بانک‌ها با Claude</button>' : '<button class="act" id="lcMan">ساخت پرامپت برای اپ Claude</button>'}
        ${Object.keys(loanCands).length ? '<button class="act" id="lcReset">برگشت به الگوی ساده</button>' : ''}<span class="mut" id="lcMsg"></span></div>
        ${!api && claudeBank ? `<p class="mut">۱) پرامپت را کپی کن و در اپ Claude بفرست. ۲) جواب (آرایه‌ی JSON) را در کادر دوم پیست کن.</p>
          <textarea class="q" id="lcPrompt" rows="4" style="width:100%;box-sizing:border-box" readonly>${esc(F.loanPrompt(claudeBank, pageText(claudeBank)))}</textarea>
          <div class="tools"><button class="act" id="lcCopy">کپی پرامپت</button></div>
          <textarea class="q" id="lcAns" rows="4" style="width:100%;box-sizing:border-box" placeholder="جواب Claude را اینجا پیست کن"></textarea>
          <div class="tools"><button class="act primary" id="lcRead">خواندن جواب</button></div>` : ''}` : ''}
      ${cands.length ? `<h3>پیشنهادها (${cands.length})</h3><p class="mut">«ناقص» یعنی آن عدد در منبع نبود؛ با «ویرایش و افزودن» خودت کاملش کن. متن اصلی منبع زیر نام طرح است.</p>
        <div class="tw"><table><tr><th>بانک</th><th>طرح</th><th>سپرده</th><th>ماه انتظار</th><th>مسدود٪ / ماه</th><th>سود سپرده٪</th><th>وام</th><th>نرخ٪</th><th>اقساط</th><th>نرخ مؤثر٪</th><th>منبع</th><th></th></tr>
        ${cands.map((p, i) => { const r = F.loanCalc(p, alt.v), dup = have.has(sig(p)), u = U.safeUrl(p.url);
          return `<tr class="${p.missing || p.active === false ? 'sell' : ''}"><td>${esc(p.bank)}</td><td class="w">${esc(p.name || '')}${p.active === false ? ' <span class="chip warn">غیرفعال</span>' : ''}
            ${p.note ? `<div class="mut" style="font-size:11px">${esc(p.note)}</div>` : ''}</td>
          <td>${fmt(p.deposit, 0)}</td><td>${fmt(p.wait, 0)}</td><td>${fmt(p.block, 0)}${p.block_months ? ' / ' + fmt(p.block_months, 0) : ''}</td><td>${fmt(p.dep_rate)}</td><td>${fmt(p.loan, 0)}</td>
          <td>${fmt(p.rate)}</td><td>${fmt(p.months, 0)}</td><td>${r.error || p.missing ? '—' : fmt(r.eff)}</td>
          <td>${esc(p.auto)}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">صفحه</a>` : ''}${p.missing ? `<div class="chip warn">ناقص: ${esc(p.missing)}</div>` : ''}</td>
          <td>${dup ? '<span class="mut">اضافه شده</span>' : `${r.error || p.missing ? '' : `<button class="act" data-cadd="${i}">افزودن</button> `}<button class="act" data-cform="${i}">ویرایش و افزودن</button>`}</td></tr>`; }).join('')}</table></div>
        <div class="tools"><button class="act" id="lcAll">افزودن همه‌ی کامل‌ها</button><button class="act" id="lcReplace">جایگزینی طرح‌های خودکار قبلی این بانک‌ها</button></div>`
        : banks.length ? '<p class="mut">در متن صفحه‌ها طرح کاملی تشخیص داده نشد؛ «استخراج با Claude» را امتحان کن.</p>' : ''}</div>`;
    const q = id => box.querySelector('#' + id), msg = (id, t) => { const e = q(id); if (e) e.textContent = t; };
    const clean = p => { const o = {}; F.PLAN_FIELDS.forEach(([k]) => { if (p[k] != null && p[k] !== '') o[k] = p[k]; });
      ['auto', 'note', 'url'].forEach(k => { if (p[k]) o[k] = p[k]; }); return o; };
    const ok = p => !p.missing && !F.loanCalc(p, alt.v).error;
    const complete = cands.filter(p => ok(p) && !have.has(sig(p)));
    q('radeAll').onchange = e => { saveLoans({ rade: { ...(L.rade || {}), active_only: !e.target.checked } }); rerender(); };
    q('radeOff').onchange = e => { saveLoans({ rade: { ...(L.rade || {}), enabled: !e.target.checked } }); updateCounts(); refreshSources(); rerender(); };
    q('laAdd').onclick = () => {
      const bank = q('laBank').value.trim(), url = q('laUrl').value.trim();
      if (!bank || !/^https?:\/\//i.test(url)) return msg('laMsg', 'نام بانک و آدرس کامل (با https://) لازم است.');
      if (srcs.some(x => x.bank === bank)) return msg('laMsg', 'این نام بانک قبلاً اضافه شده.');
      saveLoans({ sources: [...srcs, { bank, url }] }); updateCounts(); refreshSources(); rerender();
    };
    box.querySelectorAll('[data-lsdel]').forEach(b => { b.onclick = () => { const x = srcs[+b.dataset.lsdel];
      if (!confirm(`صفحه‌ی «${x.bank}» حذف شود؟ (طرح‌های اضافه‌شده می‌مانند)`)) return;
      delete loanCands[x.bank]; saveLoans({ sources: srcs.filter((_, j) => j !== +b.dataset.lsdel) }); updateCounts(); refreshSources(); rerender(); }; });
    q('lpGo').onclick = () => { const bank = q('lpBank').value.trim() || 'متن پیست‌شده', t = q('lpText').value.trim();
      if (t.length < 30) return; pastedText[bank] = t; delete loanCands[bank]; claudeBank = bank; rerender(); };
    const askApi = async list => {
      for (const b of list) {
        msg('lcMsg', `در حال استخراج «${b}» با Claude…`);
        try { loanCands[b] = F.parseLoanJson(await IM.Out.ask(F.loanPrompt(b, pageText(b)), llm), b); }
        catch (e) { msg('lcMsg', `خطا در «${b}»: ${e.message}`); return; }
      }
      rerender();
    };
    if (q('lcApi')) q('lcApi').onclick = () => askApi([q('lcBank').value]);
    if (q('lcApiAll')) q('lcApiAll').onclick = () => askApi(banks);
    if (q('lcMan')) q('lcMan').onclick = () => { claudeBank = q('lcBank').value; rerender(); };
    if (q('lcCopy')) q('lcCopy').onclick = async () => { try { await navigator.clipboard.writeText(q('lcPrompt').value); msg('lcMsg', 'کپی شد.'); } catch (e) { q('lcPrompt').select(); msg('lcMsg', 'کپی خودکار نشد؛ متن انتخاب شد، دستی کپی کن.'); } };
    if (q('lcRead')) q('lcRead').onclick = () => { try { loanCands[claudeBank] = F.parseLoanJson(q('lcAns').value, claudeBank); rerender(); } catch (e) { msg('lcMsg', 'جواب خوانده نشد: ' + e.message); } };
    if (q('lcReset')) q('lcReset').onclick = () => { Object.keys(loanCands).forEach(k => delete loanCands[k]); rerender(); };
    box.querySelectorAll('[data-cadd]').forEach(b => { b.onclick = () => { saveLoans({ plans: [...plans, clean(cands[+b.dataset.cadd])] }); rerender(); }; });
    box.querySelectorAll('[data-cform]').forEach(b => { b.onclick = () => toForm(clean(cands[+b.dataset.cform])); });
    if (q('lcAll')) q('lcAll').onclick = () => { if (complete.length) { saveLoans({ plans: [...plans, ...complete.map(clean)] }); rerender(); } };
    if (q('lcReplace')) q('lcReplace').onclick = () => {
      const bs = new Set(cands.map(p => p.bank)), keep = plans.filter(p => !(p.auto && bs.has(p.bank)));
      if (!confirm(`طرح‌های خودکار قبلی ${[...bs].join('، ')} حذف و ${complete.length} پیشنهاد کامل جایگزین شود؟ (طرح‌هایی که دستی وارد کرده‌ای می‌مانند)`)) return;
      saveLoans({ plans: [...keep, ...cands.filter(ok).map(clean)] }); rerender();
    };
  }

  const refreshLoans = () => { const el = document.querySelector(`[data-x="${LOAN_TAB}"]`); if (el) renderLoans(el); };


  // ---------------------------------------------------------------- تب «نرخ بهره‌ی واقعی»: تورم دستی + مقایسه با نرخ‌های اسمی
  const REAL_TAB = 'treal';
  function saveInflation(patch) { const c = JSON.parse(JSON.stringify(cfg)); c.inflation = { ...(c.inflation || {}), ...patch }; saveConfig(c); }
  function renderReal(el) {
    const inf = cfg.inflation || {}, entries = F.sortedInflation(inf), basis = F.inflationBasis(inf), ytm = benchYtm();
    const fmt = (v, d = 1) => v == null || !Number.isFinite(v) ? '—' : U.fmt(v, d);
    const bases = Object.keys(F.INF_BASIS).map(k => [k, (F.inflationBasis({ ...inf, basis: k }) || {}).v]).filter(([, v]) => v != null);
    const alt = altRate();
    const items = [{ name: 'میانه بازده اخزا (بدون ریسک)', nominal: ytm }, { name: 'سود سپرده‌ی بانکی', nominal: inf.deposit_rate },
      ...((cfg.loans || {}).plans || []).map(p => ({ name: `هزینه‌ی وام: ${p.bank || ''} ${p.name || ''}`.trim(), nominal: F.loanCalc(p, alt.v).eff }))].filter(x => x.nominal != null);
    const short = { p2p: 'نقطه‌به‌نقطه', avg12: 'میانگین ۱۲ ماهه', expected: 'مورد انتظار' };
    el.innerHTML = `<div class="card"><h3>نرخ بهره‌ی واقعی</h3>
      <p class="mut">نرخ واقعی = (۱ + نرخ اسمی) ÷ (۱ + تورم) − ۱. منفی یعنی پول با این سود از تورم عقب می‌ماند. تورم را از گزارش ماهانه‌ی مرکز آمار وارد کن؛ ذخیره می‌شود.</p>
      <p>${esc(F.realNote(ytm, basis))}</p>
      <div class="tools"><label>تورم مبنا (برای خلاصه و Claude):
        <select class="q" id="infBasis">${Object.entries(F.INF_BASIS).map(([k, v]) => `<option value="${k}"${(inf.basis || 'p2p') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
      <div class="fgrid"><label>تورم مورد انتظار خودت٪ (اختیاری)<input class="q" id="infExp" inputmode="decimal" value="${esc(inf.expected ?? '')}"></label>
        <label>سود سپرده‌ی بانکی٪ (اختیاری)<input class="q" id="infDep" inputmode="decimal" value="${esc(inf.deposit_rate ?? '')}"></label></div></div>
      <div class="card"><h3>مقایسه</h3>${items.length && bases.length ? `<div class="tw"><table><tr><th>نرخ</th><th>اسمی٪</th>${bases.map(([k, v]) => `<th>واقعی با تورم ${short[k]} (${fmt(v)}٪)</th>`).join('')}</tr>
        ${items.map(x => `<tr><td class="w">${esc(x.name)}</td><td>${fmt(x.nominal)}</td>${bases.map(([, v]) => { const r = F.realRate(x.nominal, v);
          return `<td class="${r > 0 ? 'up' : r < 0 ? 'dn' : ''}"><b>${fmt(r)}</b></td>`; }).join('')}</tr>`).join('')}</table></div>
        <p class="mut">برای وام‌ها «واقعی» یعنی هزینه‌ی واقعی وام: منفی یعنی تورم بخشی از بدهی را می‌خورد و وام به نفع وام‌گیرنده است.</p>`
        : `<p class="mut">${!bases.length ? 'اول تورم را وارد کن.' : 'هیچ نرخ اسمی‌ای نیست؛ دیده‌بان TSETMC را دریافت کن یا سود سپرده را وارد کن.'}</p>`}</div>
      <div class="card"><h3>تورم ماهانه (مرکز آمار)</h3><div class="fgrid">
        <label>ماه (مثل ۱۴۰۵/۰۶)<input class="q" data-i="month" value=""></label>
        <label>تورم نقطه‌به‌نقطه٪<input class="q" data-i="p2p" inputmode="decimal"></label>
        <label>تورم میانگین ۱۲ ماهه٪<input class="q" data-i="avg12" inputmode="decimal"></label>
        <label>تورم ماهانه٪ (اختیاری)<input class="q" data-i="monthly" inputmode="decimal"></label></div>
        <div class="tools"><button class="act primary" id="infAdd">ثبت ماه</button><span class="mut" id="infMsg">ماه تکراری جایگزین می‌شود.</span></div>
        ${entries.length ? `<div class="tw"><table><tr><th>ماه</th><th>نقطه‌به‌نقطه٪</th><th>میانگین ۱۲ ماهه٪</th><th>ماهانه٪</th><th></th></tr>
          ${entries.map(e => `<tr><td>${esc(e.month)}</td><td>${fmt(e.p2p)}</td><td>${fmt(e.avg12)}</td><td>${fmt(e.monthly)}</td><td><button class="act" data-m="${esc(e.month)}">حذف</button></td></tr>`).join('')}</table></div>` : ''}</div>`;
    el.querySelector('#infBasis').onchange = e => { saveInflation({ basis: e.target.value }); renderReal(el); };
    el.querySelector('#infExp').onchange = e => { saveInflation({ expected: e.target.value.trim() ? numIn(e.target.value) : null }); renderReal(el); };
    el.querySelector('#infDep').onchange = e => { saveInflation({ deposit_rate: e.target.value.trim() ? numIn(e.target.value) : null }); renderReal(el); };
    el.querySelector('#infAdd').onclick = () => {
      const g = k => el.querySelector(`[data-i="${k}"]`).value.trim();
      const month = F.normMonth(g('month'));
      if (!month) { el.querySelector('#infMsg').textContent = 'ماه را به شکل ۱۴۰۵/۰۶ بنویس.'; return; }
      const e = { month }; ['p2p', 'avg12', 'monthly'].forEach(k => { const v = g(k); if (v) e[k] = numIn(v); });
      if (e.p2p == null && e.avg12 == null && e.monthly == null) { el.querySelector('#infMsg').textContent = 'حداقل یکی از نرخ‌ها را وارد کن.'; return; }
      saveInflation({ entries: [...entries.filter(x => x.month !== month), e] }); renderReal(el);
    };
    el.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { if (!confirm(`تورم ماه ${b.dataset.m} حذف شود؟`)) return;
      saveInflation({ entries: entries.filter(x => x.month !== b.dataset.m) }); renderReal(el); }; });
  }
  const refreshReal = () => { const el = document.querySelector(`[data-x="${REAL_TAB}"]`); if (el) renderReal(el); };

  const extraTabs = () => [{ id: LOAN_TAB, title: '🏦 تسهیلات بانکی', render: renderLoans }, { id: REAL_TAB, title: '📉 نرخ بهره‌ی واقعی', render: renderReal }, { id: SRC_TAB, title: '🔀 سایت‌ها و VPN', render: renderSources }];
  const openTab = id => { activeTab = id; const b = document.querySelector(`nav button[data-s="${id}"]`); if (b) b.click(); };

  function paint() {
    const view = curView || { kpis: [], tabs: [['t0', 'شروع', [['text', 'شروع', 'هنوز داده‌ای نیست.\n۰) در Termux بزن: sh start-termux.sh و این صفحه را از http://127.0.0.1:8787 باز کن (بالای صفحه باید «🟢 سرور ترموکس وصل است» ببینی).\n۱) سایت‌های ایرانی از پیش «بدون VPN» و خارجی «با VPN» هستند؛ اگر خواستی در ⚙ تنظیمات عوضشان کن (ذخیره می‌شود).\n۲) VPN گوشی را خاموش کن و «دانلود بدون VPN» را بزن؛ بعد VPN را روشن کن و «دانلود با VPN» را بزن.\n۳) «اجرای کامل از داده‌های جمع‌شده» را بزن.\nبرای دیدن نمونه «🧪 دمو» را بزن.']]]], tables: {} };
    Dashboard.render($('app'), view, { activeTab, onTab: id => { activeTab = id; }, extra: extraTabs() });
    fixStickyOffset();
  }

  function show(view, meta) {
    curView = view; curMeta = meta;
    paint();
    lastPrompt = meta.prompt || lastPrompt;
    $('copy').disabled = $('dl').disabled = !lastPrompt;
    setMsg(`آخرین تحلیل: ${meta.time}${meta.demo ? ' (دمو)' : ''} — ${meta.nSymbols || 0} نماد`);
  }

  // ---------------------------------------------------------------- سرور ترموکس (دریافت داده از آن‌جا انجام می‌شود)
  const onHttp = /^https?:$/.test(location.protocol);
  let serverUp = false;
  function setSrv() {
    const el = $('srv');
    el.textContent = serverUp ? '🟢 سرور ترموکس وصل است' : onHttp ? '🔴 سرور ترموکس خاموش است' : '🔴 صفحه را از http://127.0.0.1:8787 باز کن';
    el.className = 'srv ' + (serverUp ? 'ok' : 'bad');
    fixStickyOffset();
  }
  async function pingServer() {
    if (!onHttp) serverUp = false;
    else { try { const r = await fetch('/api/ping', { cache: 'no-store' }); serverUp = !!(await r.json()).ok; } catch (e) { serverUp = false; } }
    setSrv(); if (serverUp) syncSettings(); return serverUp;
  }
  const serverRun = (cfg, bundle, ids, hooks) => IM.Remote.run(cfg, bundle, ids, hooks, pingServer);

  // ---------------------------------------------------------------- عملیات
  async function begin(ns) { setRunning(true); logEl().textContent = ''; Store.ns = ns; setProgress(0.03); }
  function end() { Store.ns = 'im'; setProgress(0); setRunning(false); }

  /** دریافت منابع یک دسته ('novpn' | 'vpn') */
  async function collect(group) {
    if (running) return;
    const label = group === 'vpn' ? 'با VPN' : 'بدون VPN';
    const ids = Collect.list(cfg).filter(s => Collect.modeOf(cfg, s.id) === group).map(s => s.id);
    if (!ids.length) { setMsg(`هیچ سایتی در دسته‌ی «${label}» نیست؛ در ⚙ تنظیمات دسته‌ی سایت‌ها را ببین.`); openSettings(); return; }
    await begin('im');
    try {
      await Collect.run(cfg, bundle, ids, { progress: (d, t, id) => { setProgress(d / t); setMsg(`دریافت ${label}: ${d}/${t} — ${id}`); } });
      await idb.set('bundle', bundle);
      const ok = ids.filter(i => bundle.sources[i].ok).length;
      setMsg(`دریافت ${label} تمام شد: ${ok} از ${ids.length} منبع موفق.` + (ok < ids.length ? ' ناموفق‌ها در تب «سایت‌ها و VPN» با ❌ مشخص‌اند.' : ''));
      if (ok < ids.length) { logEl().classList.add('show'); }
      refreshSources(); refreshLoans(); refreshReal();
    } catch (e) { setMsg('خطا: ' + e.message); console.warn(e.stack || e); }
    finally { end(); }
  }

  /** تحلیل کامل روی داده‌های جمع‌شده (بدون شبکه) */
  async function fullRun() {
    if (running) return;
    const rows = Collect.summary(cfg, bundle).filter(r => r.mode !== 'off');
    const have = rows.filter(r => r.hasData).length;
    if (!have) { setMsg('هنوز هیچ داده‌ای جمع نشده؛ اول سایت‌ها را در ⚙ تنظیمات دسته‌بندی کن و بعد یکی از دو دکمه‌ی دانلود را بزن.'); return; }
    await begin('im');
    try {
      const res = await Cycle.analyze(cfg, bundle, { step: (i, title) => { setProgress(i / 3); setMsg(`${i}/3 ${title}`); } });
      const meta = { time: res.time.replace('T', ' '), nSymbols: res.nSymbols, prompt: res.prompt, demo: false };
      await idb.set('last', { view: res.view, meta });
      show(res.view, meta);
      const missing = rows.length - have;
      setMsg(`${$('msg').textContent} — منابع دارای داده: ${have}/${rows.length}، ${res.signals.length} سیگنال، ${res.alerts} اعلان جدید` +
        (missing ? ` — ${missing} منبع بدون داده (در تب «سایت‌ها و VPN» ببین)` : '') + (res.llmError ? ` — خطای Claude: ${res.llmError}` : ''));
    } catch (e) { setMsg('خطا: ' + e.message); logEl().classList.add('show'); console.warn(e.stack || e); }
    finally { end(); }
  }

  /** اجرای مستقیم (همه‌ی منابع غیرغیرفعال با شبکه‌ی فعلی) یا دمو */
  async function run(isDemo) {
    if (running) return;
    await begin(isDemo ? 'demo' : 'im');
    if (isDemo) Store.clearNs();                  // دمو هر بار از صفر شروع می‌کند
    let runCfg = cfg;
    const savedRemote = Collect.remote;
    if (isDemo) { Collect.remote = null; IM.Demo.install(); runCfg = IM.Demo.config(cfg); }   // دمو داده‌ی ساختگی است و به سرور نمی‌رود
    try {
      const res = await Cycle.run(runCfg, { step: (i, title) => { setProgress(i / 3); setMsg(`${i}/3 ${title}`); },
        progress: (d, t) => { setProgress(d / t * 0.5); } }, isDemo ? { sources: {} } : bundle);
      const meta = { time: res.time.replace('T', ' '), nSymbols: res.nSymbols, prompt: res.prompt, demo: isDemo };
      show(res.view, meta);
      if (!isDemo) { await idb.set('last', { view: res.view, meta }); await idb.set('bundle', bundle); refreshSources(); refreshLoans(); refreshReal(); }
      const ok = Object.values(res.status).filter(s => String(s).startsWith('✅')).length, total = Object.keys(res.status).length;
      setMsg(`${$('msg').textContent} — منابع موفق: ${ok}/${total}، ${res.signals.length} سیگنال، ${res.alerts} اعلان جدید` + (res.llmError ? ` — خطای Claude: ${res.llmError}` : ''));
      if (ok === 0 && !isDemo) { logEl().classList.add('show'); setMsg(`${$('msg').textContent} — هیچ منبعی جواب نداد؛ اینترنت/VPN را چک کن (یا مرورگرت CORS را مسدود می‌کند).`); }
    } catch (e) {
      setMsg('خطا: ' + e.message); logEl().classList.add('show'); console.warn(e.stack || e);
    } finally {
      if (isDemo) IM.Demo.uninstall();
      Collect.remote = savedRemote;
      end();
    }
  }

  // ---------------------------------------------------------------- حالت خودکار
  function scheduleNext() {
    if (!auto) return;
    const inHours = Cycle.inMarketHours(cfg);
    const mins = inHours ? cfg.interval_minutes : Math.max(60, cfg.interval_minutes * 4);
    autoTimer = setTimeout(async () => {
      if (inHours || cfg.market_hours.run_outside_hours) await run(false);
      scheduleNext();
    }, mins * 60000);
    $('auto').title = `اجرای بعدی تا ${mins} دقیقه دیگر (صفحه باید باز بماند)`;
  }
  function toggleAuto() {
    auto = !auto; $('auto').classList.toggle('on', auto);
    clearTimeout(autoTimer);
    if (auto) { run(false).then(scheduleNext); }
  }

  // ---------------------------------------------------------------- تنظیمات / پرامپت
  function openSettings() {
    cfgDirty = false; $('cfgText').value = JSON.stringify(cfg, null, 2); $('cfgErr').textContent = '';
    renderSources($('srcBox')); $('dlg').showModal();
  }
  function download(name, text, type = 'text/markdown') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function init() {
    loadConfig(); updateCounts();
    Collect.remote = serverRun; pingServer();
    window.addEventListener('focus', pingServer); document.addEventListener('visibilitychange', () => { if (!document.hidden) pingServer(); });
    $('run').onclick = () => run(false);
    $('demo').onclick = () => run(true);
    $('collectNo').onclick = () => collect('novpn');
    $('collectVpn').onclick = () => collect('vpn');
    $('full').onclick = fullRun;
    $('auto').onclick = toggleAuto;
    $('logBtn').onclick = () => logEl().classList.toggle('show');
    $('settings').onclick = openSettings;
    $('copy').onclick = async () => { try { await navigator.clipboard.writeText(lastPrompt); setMsg('پرامپت کپی شد؛ در اپ Claude پیست کن.'); } catch (e) { setMsg('کپی ناموفق بود؛ از «دانلود پرامپت» استفاده کن.'); } };
    $('dl').onclick = () => download(`claude_prompt_${U.tehranNow().iso.replace(/[-:T]/g, '').slice(0, 12)}.md`, lastPrompt);
    $('cfgText').oninput = () => { cfgDirty = true; };
    $('cfgSave').onclick = e => {
      if (!cfgDirty) { $('dlg').close(); setMsg('ذخیره شد.'); return; }       // انتخاب سایت‌ها همان لحظه ذخیره شده است
      try { const c = JSON.parse($('cfgText').value); if (!isObj(c)) throw new Error('باید یک شیء JSON باشد'); saveConfig(merge(IM.DEFAULT_CONFIG, c)); cfgDirty = false; $('dlg').close(); setMsg('تنظیمات ذخیره شد.'); }
      catch (err) { e.preventDefault(); $('cfgErr').textContent = 'JSON نامعتبر: ' + err.message; }
    };
    $('dlg').addEventListener('close', () => { refreshSources(); refreshLoans(); refreshReal(); updateCounts(); });
    $('cfgReset').onclick = () => { try { localStorage.removeItem(CFG_KEY); } catch (e) { /* ignore */ } loadConfig(); saveConfig(cfg); cfgDirty = false; $('cfgText').value = JSON.stringify(cfg, null, 2); renderSources($('srcBox')); updateCounts(); };
    $('cfgClose').onclick = () => $('dlg').close();
    $('clearData').onclick = () => { if (confirm('تاریخچه قیمت‌ها، اخبار ذخیره‌شده، سابقه سیگنال‌ها و داده‌های جمع‌شده پاک شود؟ (تنظیمات می‌ماند)')) {
      Store.ns = 'im'; Store.clearNs(); bundle = { sources: {} }; idb.set('bundle', bundle); refreshSources(); setMsg('داده‌های محلی پاک شد.'); } };
    window.addEventListener('resize', fixStickyOffset);

    const b = await idb.get('bundle'); if (b && b.sources) bundle = b;
    const last = await idb.get('last');
    if (last && last.view) { show(last.view, last.meta); } else paint();
    fixStickyOffset();
  }
  document.addEventListener('DOMContentLoaded', init);
})(window.IM = window.IM || {});
