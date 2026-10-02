/* تنظیمات پیش‌فرض (معادل config.yaml). همه‌ی این‌ها از داخل برنامه (⚙ تنظیمات) قابل ویرایش‌اند و در مرورگر ذخیره می‌شوند.
   روزهای هفته با شماره جاوااسکریپت: یکشنبه=0 دوشنبه=1 ... چهارشنبه=3 ... شنبه=6 */
(function (IM) {
  IM.DEFAULT_CONFIG = {
    // دسته‌بندی منابع برای دکمه‌های «دانلود بدون VPN» / «دانلود با VPN». از تب «منابع و VPN» تنظیم می‌شود.
    // مقدار هر منبع: "novpn" | "vpn" | "off" (کلید = شناسه‌ی منبع مثل "tgju" یا "news:دنیای اقتصاد")؛ خالی = تعیین نشده
    source_modes: {},

    interval_minutes: 15,
    market_hours: { days: [6, 0, 1, 2, 3], start: '08:45', end: '12:45', run_outside_hours: true },

    watchlist: {
      stocks: ['فولاد', 'فملی', 'شپنا', 'شبندر', 'خودرو', 'وبملت', 'شستا', 'کگل'],
      funds: ['طلا', 'عیار', 'کهربا', 'اهرم'],
      options: [],   // فقط نماد قرارداد؛ اعمال، سررسید و دارایی پایه از نام خوانده می‌شود
    },

    benchmark_rate: 'auto',   // auto = میانه بازده اخزاهای بازار؛ یا عدد ثابت مثل 0.38
    bond_margin: 0.015,

    // تب «تسهیلات بانکی»: alt_rate = بازده سالانه‌ای که سپرده می‌توانست جای دیگر بگیرد (هزینه‌ی فرصت)؛
    // auto = میانه بازده اخزا (از دیده‌بان)، یا عدد درصدی مثل 30. plans از همان تب اضافه/ویرایش می‌شود.
    // rade: وام‌های با «مسدودی سپرده» از rade.ir (فقط وام‌های فعال اگر active_only)؛ sources: صفحه‌های طرح بانک‌ها که خودت اضافه می‌کنی
    loans: { alt_rate: 'auto', plans: [], sources: [], rade: { enabled: true, active_only: true } },

    // کاورد کال (تب «اختیار و آتی»): کارمزدهای تقریبی٪ — خرید سهم، فروش/تسویه‌ی سهم (با مالیات)، فروش اختیار. بازه‌ی روز تا سررسید.
    covered_call: { buy_fee_pct: 0.3712, sell_fee_pct: 0.88, option_fee_pct: 0.103, min_days: 3, max_days: 400, min_protection_pct: 5 },

    fund_bubble: { alert_pct: 3 },   // حباب صندوق‌ها: از این درصد به بالا در خلاصه نام برده می‌شود
    // تب «نرخ بهره‌ی واقعی»: تورم ماهانه از مرکز آمار (دستی). basis: p2p | avg12 | expected
    inflation: { basis: 'p2p', expected: null, deposit_rate: null, entries: [] },

    signals: { min_score: 3, history_days: 250, coin_bubble_sell: 12, coin_bubble_buy: 2 },

    global_tickers: { gold_ounce: 'GC=F', silver: 'SI=F', copper: 'HG=F', brent: 'BZ=F', wti: 'CL=F', natgas: 'NG=F', dxy: 'DX-Y.NYB', sp500: '^GSPC', bitcoin: 'BTC-USD', ethereum: 'ETH-USD' },
    use_yahoo: false,   // اگر false باشد قیمت‌های جهانی از tgju خوانده می‌شود

    // حساسیت نمادها به عوامل جهانی/ارزی (وزن مثبت = هم‌جهت)
    sensitivity: {
      'فولاد': { usd_irr: 1.0, copper: 0.3, brent: 0.2 }, 'کگل': { usd_irr: 1.0, copper: 0.2 }, 'فملی': { copper: 1.0, usd_irr: 1.0 },
      'شپنا': { brent: 0.8, usd_irr: 1.0 }, 'شبندر': { brent: 0.8, usd_irr: 1.0 },
      'طلا': { gold_ounce: 1.0, usd_irr: 1.0 }, 'عیار': { gold_ounce: 1.0, usd_irr: 1.0 }, 'کهربا': { gold_ounce: 1.0, usd_irr: 1.0 },
      'خودرو': { usd_irr: -0.3 }, 'وبملت': { usd_irr: 0.2 },
    },

    tgju_keys: { coin_emami: 'sekee', coin_half: 'nim', coin_quarter: 'rob', gold_18k: 'geram18', mesghal: 'mesghal', usd_irr: 'price_dollar_rl', eur_irr: 'price_eur', ounce: 'ons' },

    // فهرست سایت‌های خبری. region = کشور/منطقه، lang = fa|en، filter (اختیاری) = none|econ|relevant.
    // unverified = آدرس RSS از سرور تست تأیید نشد (۴۰۳ یا قطع اتصال)؛ خودت با «منابع و VPN» امتحان کن.
    news: {
      sites: [
        { name: "پارسیک اقتصادی", url: "https://www.parseek.com/Economic/", region: "ایران", lang: 'fa' },
        { name: "اقتصادنیوز", url: "https://www.eghtesadnews.com/", region: "ایران", lang: 'fa' },
        { name: "بورس‌پرس", url: "https://boursepress.ir/", region: "ایران", lang: 'fa' },
        { name: "سنا (بورس تهران)", url: "https://www.sena.ir/", region: "ایران", lang: 'fa' },
        { name: "تسنیم اقتصادی", url: "https://www.tasnimnews.com/fa/service/7/", region: "ایران", lang: 'fa' },
        { name: "IRNA English", url: "https://en.irna.ir/rss", region: "ایران", lang: 'en' },
        { name: "Mehr English", url: "https://en.mehrnews.com/rss", region: "ایران", lang: 'en' },
        { name: "Tehran Times", url: "https://www.tehrantimes.com/rss", region: "ایران", lang: 'en' },
        { name: "اقتصادآنلاین", url: "https://www.eghtesadonline.com/rss", region: "ایران", lang: 'fa' },
        { name: "انتخاب", url: "https://www.entekhab.ir/fa/rss/allnews", region: "ایران", lang: 'fa' },
        { name: "ایرنا", url: "https://www.irna.ir/rss", region: "ایران", lang: 'fa' },
        { name: "ایسنا", url: "https://www.isna.ir/rss", region: "ایران", lang: 'fa' },
        { name: "ایلنا", url: "https://www.ilna.ir/rss", region: "ایران", lang: 'fa' },
        { name: "بورس‌نیوز", url: "https://www.boursenews.ir/fa/rss/allnews", region: "ایران", lang: 'fa' },
        { name: "تابناک", url: "https://www.tabnak.ir/fa/rss/allnews", region: "ایران", lang: 'fa' },
        { name: "تجارت‌نیوز", url: "https://tejaratnews.com/rss", region: "ایران", lang: 'fa' },
        { name: "خبرآنلاین", url: "https://www.khabaronline.ir/rss", region: "ایران", lang: 'fa' },
        { name: "دنیای اقتصاد", url: "https://donya-e-eqtesad.com/rss", region: "ایران", lang: 'fa' },
        { name: "شانا (نفت)", url: "https://www.shana.ir/rss", region: "ایران", lang: 'fa' },
        { name: "فرارو", url: "https://fararu.com/fa/rss/allnews", region: "ایران", lang: 'fa' },
        { name: "مهر", url: "https://www.mehrnews.com/rss", region: "ایران", lang: 'fa' },
        { name: "میزان", url: "https://www.mizanonline.ir/fa/rss/allnews", region: "ایران", lang: 'fa' },
        { name: "همشهری", url: "https://www.hamshahrionline.ir/rss", region: "ایران", lang: 'fa' },
        { name: "Press TV", url: "https://www.presstv.ir/rss.xml", region: "ایران", lang: 'en', unverified: true },
        { name: "Tasnim English", url: "https://www.tasnimnews.com/en/rss/feed/0/7/0/all-stories", region: "ایران", lang: 'en', unverified: true },
        { name: "رادیو فردا", url: "https://www.radiofarda.com/api/epiqq", region: "فارسی‌زبان خارجی", lang: 'fa' },
        { name: "بی‌بی‌سی فارسی", url: "https://feeds.bbci.co.uk/persian/rss.xml", region: "فارسی‌زبان خارجی", lang: 'fa' },
        { name: "دویچه‌وله فارسی", url: "https://rss.dw.com/xml/rss-per-all", region: "فارسی‌زبان خارجی", lang: 'fa' },
        { name: "یورونیوز فارسی", url: "https://per.euronews.com/rss", region: "فارسی‌زبان خارجی", lang: 'fa' },
        { name: "ایران‌وایر", url: "https://iranwire.com/fa/feed/", region: "فارسی‌زبان خارجی", lang: 'fa', unverified: true },
        { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", region: "خاورمیانه", lang: 'en' },
        { name: "Al-Monitor", url: "https://www.al-monitor.com/rss", region: "خاورمیانه", lang: 'en' },
        { name: "BBC — خاورمیانه", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", region: "خاورمیانه", lang: 'en' },
        { name: "France24 — خاورمیانه", url: "https://www.france24.com/en/middle-east/rss", region: "خاورمیانه", lang: 'en' },
        { name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", region: "خاورمیانه", lang: 'en' },
        { name: "NPR — خاورمیانه", url: "https://feeds.npr.org/1004/rss.xml", region: "خاورمیانه", lang: 'en' },
        { name: "Guardian Middle East", url: "https://www.theguardian.com/world/middleeast/rss", region: "خاورمیانه", lang: 'en' },
        { name: "The New Arab", url: "https://www.newarab.com/rss", region: "خاورمیانه", lang: 'en', unverified: true },
        { name: "Iraqi News", url: "https://www.iraqinews.com/feed/", region: "عراق", lang: 'en' },
        { name: "Kurdistan24", url: "https://www.kurdistan24.net/en/rss.xml", region: "عراق", lang: 'en', unverified: true },
        { name: "Afghanistan International", url: "https://www.afintl.com/en/feed", region: "افغانستان", lang: 'en' },
        { name: "Amu TV", url: "https://amu.tv/feed/", region: "افغانستان", lang: 'en' },
        { name: "Ariana News", url: "https://www.ariananews.af/feed/", region: "افغانستان", lang: 'en' },
        { name: "Khaama Press", url: "https://www.khaama.com/feed/", region: "افغانستان", lang: 'en' },
        { name: "TOLOnews", url: "https://tolonews.com/rss.xml", region: "افغانستان", lang: 'en', unverified: true },
        { name: "Anadolu — اقتصاد", url: "https://www.aa.com.tr/en/rss/default?cat=economy", region: "ترکیه", lang: 'en' },
        { name: "Anadolu — جهان", url: "https://www.aa.com.tr/en/rss/default?cat=world", region: "ترکیه", lang: 'en' },
        { name: "Daily Sabah — اقتصاد", url: "https://www.dailysabah.com/rssFeed/economy", region: "ترکیه", lang: 'en' },
        { name: "Daily Sabah — کسب‌وکار", url: "https://www.dailysabah.com/rssFeed/business", region: "ترکیه", lang: 'en' },
        { name: "Turkish Minute", url: "https://www.turkishminute.com/feed/", region: "ترکیه", lang: 'en' },
        { name: "Arab News", url: "https://www.arabnews.com/rss.xml", region: "عربستان", lang: 'en', unverified: true },
        { name: "Al Arabiya English", url: "https://english.alarabiya.net/feed/rss2/en.xml", region: "عربستان", lang: 'en', unverified: true },
        { name: "Asharq Al-Awsat", url: "https://english.aawsat.com/feed", region: "عربستان", lang: 'en', unverified: true },
        { name: "Doha News", url: "https://dohanews.co/feed/", region: "قطر", lang: 'en' },
        { name: "AGBI", url: "https://www.agbi.com/feed/", region: "خلیج فارس", lang: 'en' },
        { name: "Gulf Business", url: "https://gulfbusiness.com/feed/", region: "خلیج فارس", lang: 'en', unverified: true },
        { name: "Haaretz", url: "https://www.haaretz.com/srv/haaretz-latest-headlines", region: "اسرائیل", lang: 'en' },
        { name: "Times of Israel", url: "https://www.timesofisrael.com/feed/", region: "اسرائیل", lang: 'en', unverified: true },
        { name: "SANA English", url: "https://sana.sy/en/?feed=rss2", region: "سوریه", lang: 'en' },
        { name: "Egypt Independent", url: "https://egyptindependent.com/feed/", region: "مصر", lang: 'en' },
        { name: "Business Recorder (پاکستان)", url: "https://www.brecorder.com/feeds/latest-news", region: "پاکستان", lang: 'en' },
        { name: "Dawn", url: "https://www.dawn.com/feeds/home", region: "پاکستان", lang: 'en' },
        { name: "Express Tribune", url: "https://tribune.com.pk/feed/home", region: "پاکستان", lang: 'en' },
        { name: "Report.az", url: "https://report.az/en/rss/", region: "آذربایجان", lang: 'en' },
        { name: "Trend (آذربایجان)", url: "https://en.trend.az/feeds/index.rss", region: "آذربایجان", lang: 'en' },
        { name: "RT", url: "https://www.rt.com/rss/", region: "روسیه", lang: 'en' },
        { name: "TASS", url: "https://tass.com/rss/v2.xml", region: "روسیه", lang: 'en' },
        { name: "Times of Central Asia", url: "https://timesca.com/feed/", region: "آسیای مرکزی", lang: 'en' },
        { name: "OilPrice", url: "https://oilprice.com/rss/main", region: "انرژی", lang: 'en' },
        { name: "BBC — اقتصاد", url: "https://feeds.bbci.co.uk/news/business/rss.xml", region: "جهان", lang: 'en' },
        { name: "Guardian — اقتصاد", url: "https://www.theguardian.com/business/rss", region: "جهان", lang: 'en' },
        { name: "Mining.com", url: "https://www.mining.com/feed/", region: "جهان", lang: 'en' },
      ],
    },

    // جدول‌خوان عمومی: آدرس صفحه‌ای که جدول قیمت دارد. keep = کلماتی که ردیف باید داشته باشد (اختیاری)
    other_markets: [
      { category: 'خودرو', name: 'همراه مکانیک', url: 'https://www.hamrah-mechanic.com/carprice/', min_price: 100000000 },
      { category: 'آهن‌آلات', name: 'آهن‌آنلاین میلگرد', url: 'https://ahanonline.com/product-category/میلگرد/قیمت-میلگرد/', min_price: 1000 },
    ],

    // تحلیل با Claude: manual = پرامپت آماده برای کپی/دانلود (اکانت Pro)؛ api = فراخوانی مستقیم از مرورگر با کلید API
    // هشدار: کلید API در مرورگر همین دستگاه ذخیره می‌شود؛ فقط روی دستگاه شخصی خودت استفاده کن.
    llm: { mode: 'manual', model: 'claude-sonnet-5-5', use_web_search: true, max_tokens: 2500, api_key: '' },

    // اعلان: از مرورگر مستقیماً به API تلگرام/بله ارسال می‌شود 
    notify: {
      telegram: { enabled: false, bot_token: '', chat_id: '' },
      bale: { enabled: false, bot_token: '', chat_id: '' },
      only_on_change: true,
    },
  };
})(window.IM = window.IM || {});
