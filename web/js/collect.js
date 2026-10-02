/* مرحله‌ی دریافت داده: هر سایت/سرویس یک «منبع» جدا با شناسه است. هر منبع یا با «دانلود بدون VPN» گرفته می‌شود یا «دانلود با VPN»
   (پیش‌فرض: ایرانی بدون VPN، خارجی با VPN؛ کاربر در تب «سایت‌ها و VPN» عوضش می‌کند و انتخابش ذخیره می‌شود). نتیجه‌ی خام هر منبع در یک bundle نگه داشته می‌شود
   ({sources: {id: {ok, msg, t, tryT, data}}}) و تحلیل بعداً فقط از همین bundle می‌خواند (بدون شبکه). */
(function (IM) {
  const { U, Net } = IM;
  const K = {};
  const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };

  K.MODES = { novpn: 'بدون VPN', vpn: 'با VPN', off: 'غیرفعال' };
  /** پیش‌فرض: سایت‌های ایرانی بدون VPN، سایت‌های خارجی (اخبار غیرایرانی، Yahoo/stooq) با VPN. انتخاب کاربر در source_modes روی آن می‌نشیند. */
  K.defaultMode = (cfg, id) => {
    if (id === 'global') return 'vpn';
    if (id.startsWith('news:')) {
      const site = ((cfg.news || {}).sites || []).find(s => 'news:' + s.name === id);
      return site && (site.region || 'ایران') !== 'ایران' ? 'vpn' : 'novpn';
    }
    return 'novpn';
  };
  K.isCustom = (cfg, id) => { const m = (cfg.source_modes || {})[id]; return !!m && m !== K.defaultMode(cfg, id); };
  K.modeOf = (cfg, id) => ((cfg.source_modes || {})[id]) || K.defaultMode(cfg, id);

  /** فهرست همه‌ی منابع بر اساس تنظیمات فعلی */
  K.list = cfg => [
    { id: 'tgju', label: 'tgju — طلا، سکه، ارز', host: 'tgju.org' },
    { id: 'tsetmc_watch', label: 'TSETMC — دیده‌بان کل بازار', host: 'tsetmc.com' },
    { id: 'tsetmc_index', label: 'TSETMC — شاخص‌ها', host: 'cdn.tsetmc.com' },
    { id: 'tsetmc_index_hist', label: 'TSETMC — سابقه‌ی شاخص کل، هم‌وزن و فرابورس', host: 'cdn.tsetmc.com' },
    { id: 'tgju_hist', label: 'tgju — سابقه‌ی دلار، یورو، طلا، سکه، تتر، انس، بیت‌کوین', host: 'api.tgju.org' },
    { id: 'tsetmc_nav', label: 'TSETMC — NAV صندوق‌ها (حباب)', host: 'cdn.tsetmc.com' },
    { id: 'tsetmc_symbols', label: 'TSETMC — سابقه نمادهای دیده‌بان شخصی', host: 'cdn.tsetmc.com' },
    { id: 'codal', label: 'کدال — اطلاعیه ناشران', host: 'codal.ir' },
    { id: 'ime', label: 'بورس کالا (IME)', host: 'ime.co.ir' },
    ...(cfg.use_yahoo ? [{ id: 'global', label: 'بازار جهانی (Yahoo / stooq)', host: 'yahoo.com / stooq.com' }] : []),
    ...((cfg.news || {}).sites || []).map(s => ({ id: 'news:' + s.name, label: `خبر (${s.region || 'ایران'}) — ${s.name}` + (s.unverified ? ' — آدرس تأییدنشده' : ''), host: hostOf(s.url) })),
    ...(((cfg.loans || {}).rade || {}).enabled !== false ? [{ id: 'rade', label: 'rade.ir — وام‌های با مسدودی سپرده', host: 'www.rade.ir' }] : []),
    ...((cfg.loans || {}).sources || []).map(s => ({ id: 'loanpage:' + s.bank, label: `تسهیلات — ${s.bank}`, host: hostOf(s.url) })),
    ...(cfg.other_markets || []).map(s => ({ id: 'other:' + s.name, label: `${s.category} — ${s.name}`, host: hostOf(s.url) })),
  ];

  const count = d => Array.isArray(d) ? `${d.length} ردیف` : d && typeof d === 'object' ? `${Object.keys(d).length} مورد` : '';

  async function symbols(cfg, bundle) {
    const { Tsetmc: T } = IM;
    const wl = cfg.watchlist, mwIndex = {};
    const mwSrc = bundle.sources.tsetmc_watch;
    ((mwSrc && mwSrc.data) || []).forEach(r => { mwIndex[r.symbol] = r; });
    const out = { stocks: {}, options: {} }, hist = {};
    let total = 0, ok = 0, lastErr = '';
    const safe = async fn => { try { return await fn(); } catch (e) { lastErr = e.message; return null; } };
    const days = (cfg.signals || {}).history_days || 250;
    for (const sym of [...(wl.stocks || []), ...(wl.funds || [])]) {
      total++;
      const info = await safe(() => T.resolve(sym, mwIndex));
      if (!info) continue;
      const [h, ct] = await Promise.all([safe(() => T.history(info.ins_code, days)), safe(() => T.clientType(info.ins_code))]);
      if (!h || !h.length) continue;
      out.stocks[U.normalize(sym)] = { info, hist: h, ct: ct || null }; hist[U.normalize(sym)] = h; ok++;
    }
    for (const osym of wl.options || []) {
      total++;
      const info = await safe(() => T.resolve(osym, mwIndex));
      const opt = info ? T.parseOptionName(info.name) : null;
      if (!opt) continue;
      const prem = await safe(() => T.history(info.ins_code, 5));
      let base = hist[opt.underlying];
      if (!base) { const bi = await safe(() => T.resolve(opt.underlying, mwIndex)); base = bi ? await safe(() => T.history(bi.ins_code, 120)) : null; }
      if (!prem || !prem.length || !base || !base.length) continue;
      out.options[osym] = { info, opt, prem, base }; ok++;
    }
    if (total && !ok) throw new Error('هیچ نمادی دریافت نشد' + (lastErr ? ': ' + lastErr : ''));
    out.msg = `${ok}/${total} نماد`;
    return out;
  }

  /** دریافت یک منبع؛ داده‌ی خام را برمی‌گرداند. توابع در زمان اجرا از IM خوانده می‌شوند (دمو جایگزینشان می‌کند). */
  async function fetchOne(cfg, id, bundle, today) {
    const { Src, Tsetmc: T } = IM;
    if (id === 'tgju') { const local = await Src.fetchTgju(cfg.tgju_keys); return { local, cur: Src.tgjuCur, msg: `${Object.keys(Src.tgjuCur).length} قیمت` }; }
    if (id === 'tsetmc_watch') return T.marketWatch();
    if (id === 'tsetmc_index') {
      const [a, b] = await Promise.allSettled([T.indices(), T.marketOverview()]);
      if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      return { idx: a.value || [], overview: b.value || {}, msg: `${(a.value || []).length} شاخص` };
    }
    if (id === 'tsetmc_symbols') return symbols(cfg, bundle);
    if (id === 'tsetmc_index_hist') return T.indexHistories();
    if (id === 'tgju_hist') return Src.fetchTgjuHistory();
    if (id === 'tsetmc_nav') return T.fundNavs((bundle.sources.tsetmc_watch || {}).data);
    if (id === 'codal') return Src.codalLatest();
    if (id === 'ime') return Src.imeTrades(5, today);
    if (id === 'global') return Src.fetchGlobal(cfg.global_tickers);
    if (id.startsWith('news:')) {
      const site = cfg.news.sites.find(s => 'news:' + s.name === id);
      const r = await Src.fetchSite(site);
      if (!r.length) throw new Error('هیچ تیتر اقتصادی پیدا نشد');
      return r;
    }
    if (id === 'rade') return Src.fetchRade(((cfg.loans || {}).rade || {}).active_only !== false);
    if (id.startsWith('loanpage:')) return Src.fetchLoanPage(((cfg.loans || {}).sources || []).find(s => 'loanpage:' + s.bank === id));
    if (id.startsWith('other:')) return Src.scrapeTables(cfg.other_markets.find(s => 'other:' + s.name === id));
    throw new Error('منبع ناشناخته: ' + id);
  }

  /** ids را (همزمان) می‌گیرد و در bundle می‌نویسد. اگر دریافتی شکست بخورد، داده‌ی موفق قبلی همان منبع حفظ می‌شود. */
  K.remote = null;   // اگر تابعی بگذاری (سرور ترموکس)، دریافت به‌جای مرورگر آنجا انجام می‌شود
  K.run = async (cfg, bundle, ids, hooks = {}) => {
    if (K.remote) return K.remote(cfg, bundle, ids, hooks);
    Net.reset();
    const today = U.tehranNow().date, nowIso = U.tehranNow().iso;
    let done = 0;
    const one = async id => {
      const prev = bundle.sources[id];
      try {
        const data = await fetchOne(cfg, id, bundle, today);
        const msg = (data && data.msg) || count(data);
        bundle.sources[id] = { ok: true, msg, t: nowIso, tryT: nowIso, data };
      } catch (e) {
        console.warn(`خطا در ${id}: ${e.message}`);
        bundle.sources[id] = { ok: false, msg: String(e.message).slice(0, 160), t: prev && prev.t, tryT: nowIso, data: prev && prev.data };
      }
      if (hooks.progress) hooks.progress(++done, ids.length, id);
    };
    // سابقه‌ی نمادها و NAV صندوق‌ها از دیده‌بان کل بازار کد نماد را می‌گیرند؛ پس بعد از بقیه اجرا می‌شوند
    const LATE = ['tsetmc_symbols', 'tsetmc_nav'], late = ids.filter(i => LATE.includes(i));
    await Promise.all(ids.filter(i => !LATE.includes(i)).map(one));
    for (const id of late) await one(id);
    return bundle;
  };

  /** وضعیت خلاصه برای نمایش: [{id,label,host,mode,state:'ok'|'fail'|'none',msg,t}] */
  K.summary = (cfg, bundle) => K.list(cfg).map(s => {
    const b = (bundle.sources || {})[s.id];
    return { ...s, mode: K.modeOf(cfg, s.id), custom: K.isCustom(cfg, s.id), state: !b ? 'none' : b.ok ? 'ok' : 'fail', msg: b ? b.msg : 'هنوز دریافت نشده', t: b && b.t, hasData: !!(b && b.data) };
  });

  IM.Collect = K;
})(window.IM = window.IM || {});
