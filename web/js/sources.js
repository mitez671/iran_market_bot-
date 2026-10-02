/* منابع دیگر: tgju (طلا/سکه/ارز)، بازار جهانی، اخبار، کدال، بورس کالا و جدول‌خوان عمومی. */
(function (IM) {
  const { U, Net } = IM;
  const S = { tgjuCur: {} };

  // ============================================================ tgju
  const TGJU_GLOBAL = {
    gold_ounce: [['ons'], ['ons'], [1000, 10000]],
    silver: [['silver', 'ons_silver', 'silver_ounce'], ['silver'], [5, 300]],
    brent: [['oil_brent', 'brent', 'oil-brent'], ['brent'], [20, 250]],
    wti: [['oil', 'oil_wti', 'wti'], ['wti'], [20, 250]],
    natgas: [['gas', 'natural_gas', 'oil_gas'], ['natural_gas', 'natgas'], [0.5, 30]],
    copper: [['copper', 'base_global_copper'], ['copper'], [1, 30000]],
    bitcoin: [['crypto-bitcoin', 'bitcoin'], ['bitcoin'], [5000, 1000000]],
    ethereum: [['crypto-ethereum', 'ethereum'], ['ethereum'], [100, 50000]],
  };
  const pctNum = v => U.toNum(String(v == null ? '' : v).replace('%', ''));

  S.tgjuGlobal = () => {
    const out = {}, cur = S.tgjuCur || {};
    for (const [name, [cands, subs, [lo, hi]]] of Object.entries(TGJU_GLOBAL)) {
      const keys = cands.filter(k => k in cur).concat(Object.keys(cur).filter(k => subs.some(sb => k.includes(sb)) && !cands.includes(k)));
      for (const k of keys) {
        const p = U.toNum((cur[k] || {}).p);
        if (p && p >= lo && p <= hi) { out[name] = { price: p, change_pct: pctNum(cur[k].dp), key: k }; break; }
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- سابقه‌ی قیمت tgju (برای «بازده گذشته»)
  // جدول تاریخچه‌ی صفحه‌ی هر قیمت در tgju: {data: [[باز، کمترین، بیشترین، پایانی، تغییر، درصد، تاریخ میلادی، تاریخ شمسی], ...]} (خانه‌ها گاهی HTML دارند)
  S.TGJU_HIST = { usd_irr: 'price_dollar_rl', eur_irr: 'price_eur', gold_18k: 'geram18', coin_emami: 'sekee', mesghal: 'mesghal',
    tether: 'crypto-tether-irr', gold_ounce: 'ons', bitcoin: 'crypto-bitcoin' };
  const cellText = v => String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim();
  S.tgjuHistory = async (key, n = 450) => {
    const d = await Net.json(`https://api.tgju.org/v1/market/indicator/summary-table-data/${encodeURIComponent(key)}?lang=fa&order_dir=desc&start=0&length=${n}&convert_to_ad=1`, { timeout: 25000 });
    const rows = (d && (d.data || Object.values(d).find(Array.isArray))) || [];
    const out = [];
    for (const r of rows) {
      const cells = Array.isArray(r) ? r.map(cellText) : Object.values(r || {}).map(cellText);
      let iso = null;
      for (const c of cells) {
        const m = U.digits(c).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
        if (!m) continue;
        const ds = `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
        iso = +m[1] > 1900 ? ds.replace(/\//g, '-') : U.jalaliToGregorian(ds);
        if (iso) break;
      }
      const close = Array.isArray(r) ? U.toNum(cells[3]) : U.toNum(r.close ?? r.p ?? r.price);
      if (iso && close > 0) out.push([iso, close]);
    }
    if (!out.length) throw new Error('تاریخچه خوانده نشد؛ نمونه: ' + JSON.stringify(rows[0] || d).slice(0, 160));
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };
  S.fetchTgjuHistory = async () => {
    const out = {}, errs = [];
    for (const [name, key] of Object.entries(S.TGJU_HIST)) {      // پشت سر هم تا tgju محدودیت نگذارد
      try { out[name] = await S.tgjuHistory(key); } catch (e) { errs.push(`${key}: ${e.message}`); if (/رد شد/.test(e.message)) break; }
    }
    if (!Object.keys(out).length) throw new Error(errs.join(' | '));
    if (errs.length) console.warn('سابقه‌ی tgju:', errs.join(' | '));
    return { series: out, msg: `${Object.keys(out).length}/${Object.keys(S.TGJU_HIST).length} قیمت، تا ${Math.max(...Object.values(out).map(v => v.length))} روز` };
  };

  /** keys: {نام_دلخواه: کلید_tgju} → قیمت‌ها (ریال؛ انس به دلار) */
  S.fetchTgju = async keys => {
    let cur = null, last;
    for (const host of ['call1', 'call2', 'call3', 'call4']) {
      try { cur = (await Net.json(`https://${host}.tgju.org/ajax.json`)).current || {}; break; } catch (e) { last = e; if (/رد شد/.test(e.message)) break; }
    }
    if (!cur) throw new Error('tgju unreachable: ' + (last && last.message));
    S.tgjuCur = cur;
    const out = {};
    for (const [name, key] of Object.entries(keys)) {
      const it = cur[key];
      if (!it) { console.warn('tgju key missing:', key); continue; }
      out[name] = { price: U.toNum(it.p), change_pct: pctNum(it.dp), dir: it.dt, high: U.toNum(it.h), low: U.toNum(it.l), time: it.t };
    }
    return out;
  };

  const TGJU_LABELS = {
    price_dollar_rl: 'دلار آزاد', price_eur: 'یورو', price_aed: 'درهم امارات', price_try: 'لیر ترکیه', price_cny: 'یوان چین',
    price_gbp: 'پوند', sekee: 'سکه امامی', sekeb: 'سکه بهار آزادی', nim: 'نیم سکه', rob: 'ربع سکه', gerami: 'سکه گرمی',
    geram18: 'طلای ۱۸ عیار (گرم)', geram24: 'طلای ۲۴ عیار (گرم)', mesghal: 'مثقال طلا', ons: 'انس طلا ($)', silver: 'انس نقره ($)',
    oil_brent: 'نفت برنت ($)', oil: 'نفت WTI ($)', 'crypto-bitcoin': 'بیت‌کوین ($)', 'crypto-ethereum': 'اتریوم ($)', 'crypto-tether-irr': 'تتر (ریال)',
  };
  function tgjuGroup(k) {
    k = k.toLowerCase();
    if (k.startsWith('price_') || k.includes('dollar')) return 'ارز';
    if (k.startsWith('seke') || ['nim', 'rob', 'gerami'].includes(k) || k.includes('coin')) return 'سکه';
    if (k.includes('geram') || k.includes('mesghal') || k.includes('gold') || k === 'ons') return 'طلا';
    if (k.startsWith('crypto')) return 'رمزارز';
    if (k.includes('oil') || k.includes('gas') || k.includes('brent')) return 'انرژی';
    if (['silver', 'copper', 'alum', 'zinc', 'nickel', 'lead', 'iron', 'steel', 'platinum', 'palladium', 'base_'].some(x => k.includes(x))) return 'فلزات';
    if (k.includes('bourse') || k.includes('index') || k.includes('shakhes')) return 'شاخص';
    return 'سایر';
  }
  S.tgjuAll = cur => {
    const rows = [];
    for (const [k, v] of Object.entries(cur || {})) {
      if (!v || typeof v !== 'object') continue;
      const p = U.toNum(v.p);
      if (p == null) continue;
      rows.push({ key: k, label: TGJU_LABELS[k] || '', price: p, change_pct: pctNum(v.dp), dir: v.dt, high: U.toNum(v.h), low: U.toNum(v.l), time: v.t, group: tgjuGroup(k) });
    }
    return rows.sort((a, b) => a.group.localeCompare(b.group, 'fa') || (a.label < b.label ? 1 : a.label > b.label ? -1 : 0));
  };

  // ============================================================ بازار جهانی (اختیاری؛ Yahoo و stooq)
  const STOOQ = { gold_ounce: 'xauusd', silver: 'xagusd', copper: 'hg.f', brent: 'cb.f', wti: 'cl.f', natgas: 'ng.f', dxy: 'dx.f', sp500: '^spx', bitcoin: 'btcusd', ethereum: 'ethusd' };

  async function yahoo(ticker) {
    const d = await Net.json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d`);
    const r = d.chart.result[0], q = r.indicators.quote[0];
    return r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }))
      .filter(x => x.close != null);
  }
  async function stooq(sym) {
    const text = await Net.get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, { timeout: 30000 });
    const lines = text.trim().split(/\r?\n/);
    const head = lines.shift().toLowerCase().split(',');
    const ix = n => head.indexOf(n);
    if (ix('close') < 0) throw new Error('no data');
    return lines.slice(-130).map(l => { const c = l.split(','); return { date: c[ix('date')], open: +c[ix('open')], high: +c[ix('high')], low: +c[ix('low')], close: +c[ix('close')], volume: ix('volume') >= 0 ? +c[ix('volume')] || 0 : 0 }; })
      .filter(r => isFinite(r.close));
  }
  /** tickers: {name: yahooSymbol} → {name: rows[]} */
  S.fetchGlobal = async tickers => {
    const out = {};
    await Promise.all(Object.entries(tickers).map(async ([name, t]) => {
      try { out[name] = await yahoo(t); return; } catch (e) { console.warn('yahoo', t, e.message); }
      if (STOOQ[name]) try { out[name] = await stooq(STOOQ[name]); } catch (e) { console.warn('stooq', name, e.message); }
    }));
    return out;
  };

  // ============================================================ اخبار
  const ECON_WORDS = ['بورس', 'سهام', 'شاخص', 'دلار', 'ارز', 'یورو', 'طلا', 'سکه', 'نفت', 'بنزین', 'گاز', 'تورم', 'نرخ بهره', 'بانک', 'اوراق', 'صکوک',
    'خزانه', 'بودجه', 'مالیات', 'تحریم', 'مذاکر', 'صادرات', 'واردات', 'فولاد', 'مس', 'پتروشیمی', 'خودرو', 'مسکن', 'اجاره', 'آهن', 'میلگرد', 'سیمان',
    'بورس کالا', 'قیمت', 'گرانی', 'ارزان', 'بازار', 'صندوق', 'عرضه اولیه', 'سود', 'زیان', 'رمزارز', 'بیت کوین', 'تتر', 'کالابرگ', 'یارانه', 'حقوق',
    'اقتصاد', 'تولید', 'نقدینگی', 'وام', 'تسهیلات', 'معامله', 'سرمایه', 'شرکت', 'سازمان بورس', 'فرابورس'];

  const decodeEntities = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const t = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()];
    if (t) return t;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return isFinite(code) ? String.fromCodePoint(code) : m;
  });
  const clean = t => decodeEntities(String(t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
  const absUrl = (href, base) => { try { return new URL(href, base).href; } catch (e) { return ''; } };

  function fromRss(text) {
    const items = [];
    const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
    let m;
    while ((m = re.exec(text))) {
      const b = m[0];
      const tag = n => { const x = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return x ? x[1] : ''; };
      const link = tag('link') || ((b.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || '');
      items.push({ title: clean(tag('title')), link: clean(link), published: clean(tag('pubDate') || tag('published') || tag('updated')) });
    }
    return items;
  }
  function fromHtml(text, base, parseek) {
    const out = [], re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(text))) {
      const href = m[1], title = clean(m[2]);
      if (parseek) { if (!/\/u\/\d+/.test(href)) continue; }
      else if (title.length < 25 || title.length > 220 || !/\d{3,}/.test(href)) continue;   // لینک خبری معمولاً شناسه عددی دارد
      if (title.length < 12) continue;
      out.push({ title, link: absUrl(href, base), published: '' });
    }
    return out;
  }
  // کلمات «مرتبط با ایران/منطقه»: برای سایت‌های خارجی و همسایه که فقط خبرهای به‌درد‌بخور بمانند
  const REGION_FA = ['ایران', 'تهران', 'عراق', 'افغانستان', 'عربستان', 'ترکیه', 'امارات', 'قطر', 'کویت', 'عمان', 'بحرین', 'پاکستان', 'ارمنستان',
    'آذربایجان', 'ترکمنستان', 'روسیه', 'چین', 'هند', 'لبنان', 'سوریه', 'یمن', 'اسرائیل', 'آمریکا', 'خلیج فارس', 'هرمز', 'اوپک', 'انرژی', 'ترانزیت',
    'مرز', 'خط لوله', 'هسته', 'تحریم', 'مذاکر', 'جنگ', 'حمله', 'آتش‌بس', 'نفتکش'];
  const RELEVANT_FA = ECON_WORDS.concat(REGION_FA);
  const RELEVANT_EN = ['iran', 'tehran', 'hormuz', 'persian gulf', 'opec', 'oil', 'crude', 'brent', 'gas ', 'lng', 'pipeline', 'sanction', 'rial', 'currency',
    'gold', 'trade', 'tariff', 'economy', 'economic', 'inflation', 'bank', 'market', 'invest', 'border', 'transit', 'nuclear', 'energy', 'petrochem', 'export',
    'import', 'budget', 'imf', 'world bank', 'dollar', 'lira', 'dinar', 'afghani', 'riyal', 'dirham', 'war', 'strike', 'ceasefire', 'attack', 'missile', 'drone',
    'tanker', 'shipping', 'houthi', 'hezbollah', 'iraq', 'afghanistan', 'saudi', 'turkey', 'turkish', 'emirates', 'qatar', 'kuwait', 'oman', 'pakistan', 'azerbaijan', 'armenia', 'russia', 'china'];

  /** filter: 'none' | 'econ' (فقط اقتصادی) | 'relevant' (اقتصادی یا مرتبط با ایران/منطقه). پیش‌فرض: سایت ایرانیِ فارسی=econ، بقیه=relevant */
  S.matchesFilter = (title, site) => {
    const f = site.filter || (site.lang === 'en' || (site.region && site.region !== 'ایران') ? 'relevant' : 'econ');
    if (f === 'none') return true;
    if (site.lang === 'en') { const t = title.toLowerCase(); return RELEVANT_EN.some(w => t.includes(w)); }
    const words = new Set(title.match(/[\p{L}\p{N}]+/gu) || []);   // کلمه‌های ۲ حرفی (مثل «مس») فقط به‌صورت کلمه‌ی کامل، نه داخل «مسابقات»
    return (f === 'econ' ? ECON_WORDS : RELEVANT_FA).some(w => (w.length <= 2 ? words.has(w) : title.includes(w)));
  };

  S.fetchSite = async (site, limit = 60) => {
    const text = await Net.get(site.url, { timeout: 25000 });
    const isFeed = /^\s*(<\?xml|<rss|<feed)/i.test(text.slice(0, 200));
    const items = isFeed ? fromRss(text) : fromHtml(text, site.url, site.url.includes('parseek.com'));
    const parseek = site.url.includes('parseek');
    const seen = new Set(), out = [];
    for (const it of items) {
      if (!it.title || seen.has(it.title)) continue;
      if (!parseek && !S.matchesFilter(it.title, site)) continue;
      seen.add(it.title);
      out.push(Object.assign(it, { source: site.name, region: site.region || 'ایران', lang: site.lang || 'fa' }));
      if (out.length >= limit) break;
    }
    return out;
  };
  /** ادغام فهرست‌های خبر از چند سایت و حذف تیترهای تقریباً یکسان */
  S.mergeNews = lists => {
    const seen = new Set(), items = [];
    for (const it of [].concat(...lists)) {
      const k = it.title.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40);
      if (seen.has(k)) continue;
      seen.add(k); items.push(it);
    }
    return items;
  };
  S.fetchAllNews = async sites => {
    const status = {}, all = [];
    await Promise.all((sites || []).map(async s => {
      try { const r = await S.fetchSite(s); status[s.name] = r.length; all.push(...r); } catch (e) { status[s.name] = e.message.slice(0, 80); }
    }));
    const items = S.mergeNews([all]);
    return { items, status };
  };

  S.codalLatest = async (n = 60) => {
    const url = 'https://search.codal.ir/api/search/v2/q?&Audited=true&AuditorRef=-1&Category=-1&Childs=true&CompanyState=-1&CompanyType=-1&Consolidatable=true' +
      '&IsNotAudited=false&Length=-1&LetterType=-1&Mains=true&NotAudited=true&NotConsolidatable=true&PageNumber=1&Publisher=false&TracingNo=-1&search=false';
    const d = await Net.json(url, { timeout: 25000 });
    return (d.Letters || []).slice(0, n).map(L => ({ symbol: clean(L.Symbol), company: clean(L.CompanyName), title: clean(L.Title), time: L.PublishDateTime || '',
      link: L.Url ? absUrl(L.Url, 'https://www.codal.ir/') : 'https://www.codal.ir/' }));
  };

  // ============================================================ بورس کالا
  S.imeTrades = async (daysBack = 5, today) => {
    const to = today || new Date().toISOString().slice(0, 10);
    const slash = d => d.replace(/-/g, '/');
    const payload = { Language: 8, fari: false, GregorianFromDate: slash(U.addDays(to, -daysBack)), GregorianToDate: slash(to), MainCat: 0, Cat: 0, SubCat: 0, Producer: 0 };
    let d = await Net.postJson('https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList', payload, { timeout: 40000 });
    d = d.d !== undefined ? d.d : d;
    if (typeof d === 'string') d = JSON.parse(d);
    if (!Array.isArray(d)) return [];
    return d.map(raw => {
      const low = {}; Object.keys(raw).forEach(k => { low[k.toLowerCase()] = raw[k]; });
      const pick = (...ks) => { for (const k of ks) if (low[k] != null) return low[k]; return null; };
      const n = (...ks) => U.num(pick(...ks));
      const row = { date: pick('date', 'jalalidate', 'tarikh') || '', kala: pick('goodsname', 'kalaname', 'name') || '', producer: pick('producername', 'tolidkonande') || '',
        base_price: n('arzebaseprice', 'baseprice'), price: n('price', 'finalprice', 'avgprice'), max_price: n('maxprice'),
        volume: n('quantity', 'moamele', 'tradevolume'), value: n('totalprice', 'totalvalue', 'arzesh'), group: pick('maingroupname', 'groupname', 'catname') || '' };
      row.premium_pct = row.base_price && row.price != null ? (row.price / row.base_price - 1) * 100 : null;   // رقابت بالای پایه = تقاضای قوی
      return row;
    });
  };
  S.imeSummary = rows => {
    const g = {};
    for (const r of rows || []) {
      if (r.premium_pct == null) continue;
      const k = String(r.kala).split(/\s+/).slice(0, 2).join(' ');
      const x = g[k] || (g[k] = { kala_short: k, trades: 0, _p: [], _pr: [], value: 0 });
      x.trades++; x._p.push(r.premium_pct); if (r.price != null) x._pr.push(r.price); x.value += r.value || 0;
    }
    return Object.values(g).map(x => ({ kala_short: x.kala_short, trades: x.trades, avg_premium: U.mean(x._p), avg_price: U.mean(x._pr), value: x.value }))
      .sort((a, b) => b.value - a.value);
  };

  // ============================================================ جدول‌خوان عمومی (خودرو، آهن، مسکن، ...)
  /** ردیف‌های همه‌ی جدول‌های صفحه: [[سلول, ...], ...] (بدون DOMParser تا هم در مرورگر و هم در Node کار کند) */
  S.parseTableRows = html => {
    const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ''), rows = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = trRe.exec(body))) {
      const cells = [], tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = tdRe.exec(m[1]))) { const t = clean(c[1]); if (t) cells.push(t); }
      rows.push(cells);
    }
    return rows;
  };
  /** متن خوانای یک صفحه‌ی HTML (بدون DOMParser تا در سرور ترموکس هم کار کند) */
  S.htmlText = html => {
    const ent = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', zwnj: '\u200c', rlm: '', lrm: '' };
    return String(html || '')
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article|td|th)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ent ? ent[n.toLowerCase()] : m))
      .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n[ \n]*/g, '\n').trim();
  };
  /** صفحه‌ی طرح‌های تسهیلات یک بانک → {text, msg} */
  S.fetchLoanPage = async src => {
    const html = await Net.get(src.url, { timeout: 30000 });
    const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const text = S.htmlText(html).slice(0, 30000);
    if (text.length < 200) throw new Error('متن قابل خواندنی در صفحه نبود (احتمالاً با جاوااسکریپت پر می‌شود، یا عکس/PDF است؛ متن را دستی پیست کن)');
    if (!/وام|تسهیلات/.test(text)) throw new Error('کلمه‌ی «وام» یا «تسهیلات» در صفحه نبود؛ آدرس را چک کن');
    return { text, title: S.htmlText(title).slice(0, 120), msg: `${text.length.toLocaleString('en-US')} نویسه` };
  };

  // ---------------------------------------------------------------- rade.ir: فهرست وام‌های با «مسدودی سپرده» + صفحه‌ی جزئیات هر وام
  // فهرست از admin-ajax (action=rade_sync_filter، همان فیلتر صفحه‌ی rade.ir/loan)؛ جزئیات از برچسب‌های ثابت صفحه‌ی هر وام.
  S.RADE_LABELS = ['نام وام', 'بانک', 'نوع وام', 'نرخ سود وام', 'مجموع سود وام', 'کف وام', 'سقف وام', 'مبلغ قسط', 'مجموع وام و سود', 'حداکثر زمان بازپرداخت',
    'نیاز به سپرده', 'نیاز به سپرده جداگانه', 'ثبت‌نام آنلاین', 'مسدودی سپرده', 'مدت زمان مسدودی سپرده', 'مدت زمان خواب سپرده', 'حداقل مبلغ سپرده',
    'نرخ سود سپرده', 'نرخ سود سپرده پس از وام', 'هزینه فرصت مسدودی', 'نسبت مبلغ وام به میزان سپرده', 'حساب سپرده لازم', 'نوع ضمانت', 'هزینه‌های جانبی',
    'وضعیت', 'وضعیت ارائه وام توسط بانک', 'توضیحات'];
  S.radeList = async (activeOnly = true) => {
    const links = new Set(); let page = 1, max = 1;
    do {
      const body = 'action=rade_sync_filter&filter_data%5BpostType%5D=loan&filter_data%5BmultiSelect_guaranteeTypes%5D%5B%5D=deposit_block' +
        `&filter_data%5Bpage%5D=${page}` + (activeOnly ? '&filter_data%5Bstatus%5D=true' : '');
      const d = await Net.request('https://www.rade.ir/wp-admin/admin-ajax.php', { method: 'POST', as: 'json', body, timeout: 30000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } });
      if (!d || !d.success) throw new Error('پاسخ فیلتر rade نامعتبر: ' + JSON.stringify(d).slice(0, 120));
      for (const m of String((d.data || {}).html || '').matchAll(/href="(https:\/\/www\.rade\.ir\/loan-[a-z-]+\/\d+-[^"]+)"/g)) links.add(m[1]);
      max = Math.min(10, +((d.pagination || {}).max_page) || 1);
    } while (++page <= max);
    return [...links];
  };
  S.radeDetail = async url => {
    const t = S.htmlText(await Net.get(url, { timeout: 30000 }));
    const a = t.indexOf('\nنام وام\n'), z = t.indexOf('\nوام‌های مرتبط', a);
    if (a < 0) throw new Error('ساختار صفحه‌ی جزئیات rade شناخته نشد');
    const f = {}; let key = null;
    for (const line of t.slice(a + 1, z > a ? z : a + 6000).split('\n')) {
      if (S.RADE_LABELS.includes(line)) { key = line; f[key] = f[key] || ''; } else if (key) f[key] += (f[key] ? ' ' : '') + line;
    }
    f.inactive = /این خدمت فعلا ارائه نمی‌شود|در حال حاضر این طرح ارائه نمی‌شود/.test(t);
    return f;
  };
  /** مبلغ متنی → میلیون تومان ('300 میلیون تومان'، '1.5 میلیارد تومان'، '50,000,000 تومان') */
  S.amountMT = s => {
    const x = U.digits(String(s || '')).replace(/٫/g, '.');
    const m = x.match(/([\d.,]+)\s*(میلیارد|میلیون)?\s*(تومان|ریال)?/);
    if (!m) return null;
    let v = parseFloat(m[1].replace(/,/g, '')); if (!isFinite(v) || v <= 0) return null;
    v = m[2] === 'میلیارد' ? v * 1000 : m[2] === 'میلیون' ? v : v / 1e6;
    return m[3] === 'ریال' ? v / 10 : v;
  };
  const firstNum = s => { const m = U.digits(String(s || '')).replace(/٫/g, '.').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };
  /** فیلدهای rade → طرح داشبورد. note = خلاصه‌ی متن اصلی برای چک کردن */
  S.radePlan = (f, url) => {
    const loan = S.amountMT(f['سقف وام']), months = /ماه/.test(f['حداکثر زمان بازپرداخت'] || '') ? firstNum(f['حداکثر زمان بازپرداخت']) : null;
    const ratioTxt = f['نسبت مبلغ وام به میزان سپرده'] || '', rv = firstNum(ratioTxt);
    const ratio = rv == null ? null : /برابر/.test(ratioTxt) ? rv : /٪|%|درصد/.test(ratioTxt) ? rv / 100 : rv > 10 ? rv / 100 : rv;
    // نسبت وام به سپرده، سپرده‌ی متناظر با سقف وام را می‌دهد؛ «حداقل مبلغ سپرده» معمولاً مال کف وام است
    let deposit = loan && ratio ? loan / ratio : S.amountMT(f['حداقل مبلغ سپرده']);
    const blockM = /ماه/.test(f['مدت زمان مسدودی سپرده'] || '') ? firstNum(f['مدت زمان مسدودی سپرده']) : null;
    const waitTxt = f['مدت زمان خواب سپرده'] || '';
    const p = { bank: (f['بانک'] || '').trim(), name: (f['نام وام'] || '').trim(), auto: 'رده', url,
      rate: /نامشخص|متغیر/.test(f['نرخ سود وام'] || '') && firstNum(f['نرخ سود وام']) == null ? undefined : firstNum(f['نرخ سود وام']),
      loan: loan || undefined, months: months || undefined, deposit: deposit ? Math.round(deposit * 10) / 10 : undefined,
      wait: /^\s*[\d.]+\s*ماه/.test(U.digits(waitTxt)) ? firstNum(waitTxt) : /^\s*[\d.]+\s*روز/.test(U.digits(waitTxt)) ? Math.round(firstNum(waitTxt) / 30) : 0,
      block: blockM != null || /مسدود/.test(f['نوع ضمانت'] || '') ? 100 : 0, block_months: blockM || undefined,
      dep_rate: firstNum(f['نرخ سود سپرده']) ?? undefined, active: !f.inactive };
    p.note = [['نرخ', f['نرخ سود وام']], ['سپرده', f['حداقل مبلغ سپرده']], ['نسبت وام به سپرده', ratioTxt], ['خواب سپرده', waitTxt],
      ['مسدودی', f['مدت زمان مسدودی سپرده']], ['حساب', f['حساب سپرده لازم']], ['ضمانت', f['نوع ضمانت']]]
      .filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim().slice(0, 140)}`).join(' | ');
    const miss = [p.deposit == null && 'مبلغ سپرده', p.rate == null && 'نرخ', p.loan == null && 'سقف وام', p.months == null && 'مدت'].filter(Boolean);
    if (/بلندمدت|کوتاه/.test(f['حساب سپرده لازم'] || '') && p.dep_rate == null) miss.push('سود سپرده');
    if (miss.length) p.missing = miss.join('، ');
    Object.keys(p).forEach(k => p[k] === undefined && delete p[k]);
    return p;
  };
  S.fetchRade = async (activeOnly = true) => {
    const links = await S.radeList(activeOnly);
    if (!links.length) throw new Error('rade هیچ وام با مسدودی سپرده‌ای برنگرداند');
    const plans = [], errs = []; let i = 0;
    const worker = async () => { while (i < links.length) { const u = links[i++];
      try { const f = await S.radeDetail(u); if (/مسدود|سپرده/.test((f['نوع ضمانت'] || '') + (f['مسدودی سپرده'] || '') + (f['نیاز به سپرده'] || ''))) plans.push(S.radePlan(f, u)); }
      catch (e) { errs.push(e.message); if (/رد شد/.test(e.message)) return; } } };
    await Promise.all([worker(), worker(), worker()]);
    if (!plans.length) throw new Error('جزئیات هیچ وامی خوانده نشد' + (errs[0] ? ': ' + errs[0] : ''));
    if (errs.length) console.warn(`rade: ${errs.length} صفحه‌ی جزئیات ناموفق، اولی: ${errs[0]}`);
    return { plans, msg: `${plans.length} وام با سپرده از ${links.length} نتیجه` };
  };

  S.scrapeTables = async src => {
    const html = await Net.get(src.url, { timeout: 30000 });
    const rows = [], keep = src.keep || [], minPrice = src.min_price || 1000;
    for (const cells of S.parseTableRows(html)) {
      if (cells.length < 2) continue;
      const nums = cells.slice(1).map(U.toNum).filter(n => n && n >= minPrice);
      if (!nums.length) continue;
      if (keep.length && !keep.some(k => cells.join(' ').includes(k))) continue;
      rows.push({ category: src.category || '', item: cells[0].slice(0, 80), price: nums[0], detail: cells.slice(1, 5).join(' | ').slice(0, 160), source: src.name || new URL(src.url).hostname });
    }
    if (!rows.length) throw new Error('جدول قیمت پیدا نشد (احتمالاً صفحه با جاوااسکریپت پر می‌شود)');
    const seen = new Set();
    return rows.filter(r => { const k = r.item + '|' + r.price; return !seen.has(k) && seen.add(k); });
  };
  S.otherMarkets = async srcs => {
    const rows = [], errors = [];
    await Promise.all((srcs || []).map(async src => {
      try { rows.push(...await S.scrapeTables(src)); } catch (e) { errors.push(`${src.category}/${src.name}: ${e.message.slice(0, 120)}`); console.warn('منبع', src.name, e.message); }
    }));
    return { rows, errors };
  };

  IM.Src = S;
})(window.IM = window.IM || {});
