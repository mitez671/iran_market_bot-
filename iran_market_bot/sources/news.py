"""اخبار از چند سایت ایرانی + اطلاعیه‌های کدال.

هر سایت فقط یک آدرس در config.yaml است. اگر صفحه RSS باشد خوانده می‌شود، وگرنه تیترها از لینک‌های صفحه
استخراج می‌شوند (لینک‌های خبری با متن بلند). پارسیک الگوی اختصاصی دارد.
"""
from __future__ import annotations

import html as _html
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

import requests

log = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "fa-IR,fa;q=0.9"}

DEFAULT_SITES = [
    {"name": "پارسیک اقتصادی", "url": "https://www.parseek.com/Economic/"},
    {"name": "دنیای اقتصاد", "url": "https://donya-e-eqtesad.com/"},
    {"name": "اقتصادآنلاین", "url": "https://www.eghtesadonline.com/"},
    {"name": "اقتصادنیوز", "url": "https://www.eghtesadnews.com/"},
    {"name": "تجارت‌نیوز", "url": "https://tejaratnews.com/"},
    {"name": "بورس‌پرس", "url": "https://boursepress.ir/"},
    {"name": "سنا (بورس تهران)", "url": "https://www.sena.ir/"},
    {"name": "ایسنا اقتصادی", "url": "https://www.isna.ir/service/Economy"},
    {"name": "تسنیم اقتصادی", "url": "https://www.tasnimnews.com/fa/service/7/"},
    {"name": "ایرنا اقتصادی", "url": "https://www.irna.ir/service/economy"},
]

ECON_WORDS = ["بورس", "سهام", "شاخص", "دلار", "ارز", "یورو", "طلا", "سکه", "نفت", "بنزین", "گاز", "تورم", "نرخ بهره",
              "بانک", "اوراق", "صکوک", "خزانه", "بودجه", "مالیات", "تحریم", "مذاکر", "صادرات", "واردات", "فولاد", "مس",
              "پتروشیمی", "خودرو", "مسکن", "اجاره", "آهن", "میلگرد", "سیمان", "بورس کالا", "قیمت", "گرانی", "ارزان",
              "بازار", "صندوق", "عرضه اولیه", "سود", "زیان", "رمزارز", "بیت کوین", "تتر", "کالابرگ", "یارانه", "حقوق",
              "اقتصاد", "تولید", "نقدینگی", "وام", "تسهیلات", "معامله", "سرمایه", "شرکت", "سازمان بورس", "فرابورس"]


def _clean(t: str) -> str:
    t = _html.unescape(re.sub(r"<[^>]+>", " ", t or ""))
    return re.sub(r"\s+", " ", t).replace("ي", "ی").replace("ك", "ک").strip()


def _fetch(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=25)
    r.raise_for_status()
    if (r.encoding or "").lower() in ("", "iso-8859-1"):
        r.encoding = "utf-8"
    return r.text


def _from_rss(text: str) -> list[dict]:
    import feedparser
    f = feedparser.parse(text)
    return [{"title": _clean(e.get("title", "")), "link": e.get("link"), "published": e.get("published", "")}
            for e in f.entries]


_A = re.compile(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', re.S | re.I)


def _from_html(text: str, base: str, parseek: bool) -> list[dict]:
    out = []
    for href, inner in _A.findall(text):
        title = _clean(inner)
        if parseek:
            if not re.search(r"/u/\d+", href):
                continue
        elif not (25 <= len(title) <= 220) or not re.search(r"\d{3,}", href):
            continue  # لینک خبری معمولاً شناسه عددی دارد
        if len(title) < 12:
            continue
        out.append({"title": title, "link": urljoin(base, href), "published": ""})
    return out


def fetch_site(site: dict, limit: int = 60) -> list[dict]:
    text = _fetch(site["url"])
    items = _from_rss(text) if text.lstrip()[:200].lower().startswith(("<?xml", "<rss", "<feed")) else \
        _from_html(text, site["url"], "parseek.com" in site["url"])
    general = "parseek" not in site["url"]
    seen, out = set(), []
    for it in items:
        if it["title"] in seen:
            continue
        if general and not any(w in it["title"] for w in ECON_WORDS):
            continue
        seen.add(it["title"])
        out.append(dict(it, source=site["name"]))
        if len(out) >= limit:
            break
    return out


def fetch_all(sites: list[dict] | None = None) -> tuple[list[dict], dict]:
    sites = sites or DEFAULT_SITES
    items, status = [], {}

    def job(s):
        try:
            return s, fetch_site(s), None
        except Exception as e:  # noqa: BLE001
            return s, [], f"{type(e).__name__}"

    with ThreadPoolExecutor(max_workers=6) as ex:
        for s, res, err in ex.map(job, sites):
            status[s["name"]] = err or len(res)
            items += res
    # حذف تکراری‌ها بین سایت‌ها (تیترهای تقریباً یکسان)
    seen, uniq = set(), []
    for it in items:
        k = re.sub(r"[^\w]", "", it["title"])[:40]
        if k in seen:
            continue
        seen.add(k)
        uniq.append(it)
    return uniq, status


# ============================================================ کدال
def codal_latest(n: int = 60) -> list[dict]:
    """آخرین اطلاعیه‌های ناشران (صورت مالی، گزارش ماهانه، افزایش سرمایه، مجمع)."""
    url = ("https://search.codal.ir/api/search/v2/q?&Audited=true&AuditorRef=-1&Category=-1&Childs=true"
           "&CompanyState=-1&CompanyType=-1&Consolidatable=true&IsNotAudited=false&Length=-1&LetterType=-1"
           "&Mains=true&NotAudited=true&NotConsolidatable=true&PageNumber=1&Publisher=false&TracingNo=-1&search=false")
    r = requests.get(url, headers={**UA, "Accept": "application/json"}, timeout=25)
    r.raise_for_status()
    out = []
    for L in (r.json().get("Letters") or [])[:n]:
        link = L.get("Url") or ""
        out.append({"symbol": _clean(L.get("Symbol", "")), "company": _clean(L.get("CompanyName", "")),
                    "title": _clean(L.get("Title", "")), "time": L.get("PublishDateTime", ""),
                    "link": urljoin("https://www.codal.ir/", link) if link else "https://www.codal.ir/"})
    return out
