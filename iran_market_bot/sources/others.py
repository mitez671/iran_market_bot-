"""منابع دیگر: قیمت طلا/سکه/ارز داخلی (tgju)، بازارهای جهانی (yfinance)، اخبار (RSS)."""
from __future__ import annotations

import logging
from urllib.parse import quote_plus

import pandas as pd
import requests

log = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36"}


# ============================================================ طلا، سکه، ارز
def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


_TGJU_CUR: dict = {}

# کلیدهای احتمالی tgju برای بازار جهانی + بازه منطقی قیمت (برای جلوگیری از انتخاب کلید اشتباه)
TGJU_GLOBAL = {
    "gold_ounce": (["ons"], ["ons"], (1000, 10000)),
    "silver": (["silver", "ons_silver", "silver_ounce"], ["silver"], (5, 300)),
    "brent": (["oil_brent", "brent", "oil-brent"], ["brent"], (20, 250)),
    "wti": (["oil", "oil_wti", "wti"], ["wti"], (20, 250)),
    "natgas": (["gas", "natural_gas", "oil_gas"], ["natural_gas", "natgas"], (0.5, 30)),
    "copper": (["copper", "base_global_copper"], ["copper"], (1, 30000)),
    "bitcoin": (["crypto-bitcoin", "bitcoin"], ["bitcoin"], (5000, 1000000)),
    "ethereum": (["crypto-ethereum", "ethereum"], ["ethereum"], (100, 50000)),
}


def tgju_global() -> dict:
    """قیمت‌های جهانی از همان پاسخ tgju (بدون نیاز به VPN). خروجی: {name: {price, change_pct, key}}"""
    out = {}
    cur = _TGJU_CUR or {}
    for name, (cands, subs, (lo, hi)) in TGJU_GLOBAL.items():
        keys = [k for k in cands if k in cur] + [k for k in cur if any(sb in k for sb in subs) and k not in cands]
        for k in keys:
            p = _num((cur.get(k) or {}).get("p"))
            if p and lo <= p <= hi:
                out[name] = {"price": p, "change_pct": _num(str(cur[k].get("dp", "")).replace("%", "")), "key": k}
                break
    return out


def fetch_tgju(keys: dict) -> dict:
    """keys: {نام_دلخواه: کلید_tgju}. خروجی به ریال (انس به دلار)."""
    cur, last = None, None
    for host in ["call1", "call2", "call3", "call4"]:
        try:
            r = requests.get(f"https://{host}.tgju.org/ajax.json", headers=UA, timeout=15)
            r.raise_for_status()
            cur = r.json().get("current", {})
            break
        except Exception as e:  # noqa: BLE001
            last = e
    if cur is None:
        raise RuntimeError(f"tgju unreachable: {last}")
    global _TGJU_CUR
    _TGJU_CUR = cur
    try:
        from pathlib import Path
        kf = Path(__file__).resolve().parent.parent / "data" / "tgju_keys.txt"
        kf.parent.mkdir(exist_ok=True)
        kf.write_text("\n".join(f"{k}\t{(v or {}).get('p', '')}" for k, v in sorted(cur.items())), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    out = {}
    for name, key in keys.items():
        item = cur.get(key)
        if not item:
            log.warning("tgju key missing: %s", key)
            continue
        out[name] = {
            "price": _num(item.get("p")),
            "change_pct": _num(str(item.get("dp", "")).replace("%", "")),
            "dir": item.get("dt"),        # high / low
            "high": _num(item.get("h")),
            "low": _num(item.get("l")),
            "time": item.get("t"),
        }
    return out


# ============================================================ بازار جهانی
STOOQ = {"gold_ounce": "xauusd", "silver": "xagusd", "copper": "hg.f", "brent": "cb.f", "wti": "cl.f",
         "natgas": "ng.f", "dxy": "dx.f", "sp500": "^spx", "bitcoin": "btcusd", "ethereum": "ethusd"}


def _stooq(sym: str) -> pd.DataFrame:
    import io
    r = requests.get(f"https://stooq.com/q/d/l/?s={sym}&i=d", headers=UA, timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    if "Close" not in df:
        raise ValueError("no data")
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").rename(columns=str.lower).tail(130)
    if "volume" not in df:
        df["volume"] = 0
    return df[["open", "high", "low", "close", "volume"]].dropna(subset=["close"])


def fetch_global(tickers: dict, period: str = "6mo") -> dict[str, pd.DataFrame]:
    out = _fetch_yf(tickers, period)
    for name in tickers:
        if name in out or name not in STOOQ:
            continue
        try:
            out[name] = _stooq(STOOQ[name])
        except Exception as e:  # noqa: BLE001
            log.warning("stooq %s failed: %s", name, e)
    return out


def _fetch_yf(tickers: dict, period: str) -> dict[str, pd.DataFrame]:
    out = {}
    try:
        import yfinance as yf
        import logging as _l
        _l.getLogger("yfinance").setLevel(_l.CRITICAL)
        # اگر یاهو اصلاً در دسترس نیست، وقت را برای تک‌تک نمادها هدر نده
        requests.head("https://query1.finance.yahoo.com", timeout=8)
    except Exception as e:  # noqa: BLE001
        log.warning("Yahoo Finance در دسترس نیست (%s) — از stooq استفاده می‌شود", type(e).__name__)
        return out
    for name, t in tickers.items():
        try:
            df = yf.download(t, period=period, interval="1d", progress=False, auto_adjust=False)
            if df is None or df.empty:
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna(subset=["close"])
            out[name] = df
        except Exception as e:  # noqa: BLE001
            log.warning("yfinance %s failed: %s", t, e)
    return out


def fetch_nobitex() -> dict:
    """قیمت تتر/بیت‌کوین/اتریوم به ریال از نوبیتکس (به‌عنوان شاخص دلار آزاد و کریپتو داخلی)."""
    r = requests.get("https://api.nobitex.ir/market/stats?srcCurrency=usdt,btc,eth&dstCurrency=rls", headers=UA, timeout=30)
    r.raise_for_status()
    st, out = r.json().get("stats", {}), {}
    for k, name in [("usdt-rls", "usdt_irr"), ("btc-rls", "btc_irr"), ("eth-rls", "eth_irr")]:
        v = st.get(k) or {}
        if v.get("latest"):
            out[name] = {"price": _num(v["latest"]), "change_pct": _num(v.get("dayChange")),
                         "high": _num(v.get("dayHigh")), "low": _num(v.get("dayLow")), "dir": None, "time": None}
    return out


# ============================================================ اخبار
POS_FA = ["رشد", "افزایش سود", "توافق", "لغو تحریم", "کاهش نرخ بهره", "رونق", "صعود", "حمایت", "تزریق نقدینگی",
          "سبز", "ورود پول", "مثبت", "رکورد", "خرید حقیقی", "کاهش تنش", "آزادسازی"]
NEG_FA = ["سقوط", "ریزش", "تحریم", "افزایش نرخ بهره", "تنش", "جنگ", "حمله", "خروج پول", "قرمز", "زیان", "رکود",
          "کاهش سود", "صف فروش", "توقف نماد", "شکست مذاکرات", "اسنپ بک", "قیمت‌گذاری دستوری", "مالیات"]
POS_EN = ["rally", "surge", "deal", "rate cut", "gain", "record high", "eases", "rebound"]
NEG_EN = ["sanction", "plunge", "fall", "war", "strike", "rate hike", "slump", "tension", "crash", "attack"]
IMPACT_TAGS = {
    "ارز": ["دلار", "ارز", "نرخ ارز", "یورو", "dollar", "rial"],
    "طلا": ["قیمت طلا", "طلای", "بازار طلا", "سکه", "انس", "gold"],
    "نفت/انرژی": ["قیمت نفت", "نفت خام", "صادرات نفت", "اوپک", "برنت", "oil", "opec", "brent"],
    "سیاست/تحریم": ["تحریم", "مذاکرات", "توافق هسته", "اسنپ", "آژانس", "sanction", "nuclear", "snapback"],
    "پولی/نرخ بهره": ["نرخ بهره", "بانک مرکزی", "اوراق", "حراج", "fed", "rate"],
    "بورس": ["بورس", "شاخص کل", "فرابورس", "عرضه اولیه", "سهام"],
    "کریپتو": ["بیت کوین", "رمزارز", "bitcoin", "crypto"],
}


def _score(text: str) -> int:
    t = text.lower()
    s = sum(w in t for w in POS_FA + POS_EN) - sum(w in t for w in NEG_FA + NEG_EN)
    return max(-3, min(3, s))


def _tags(text: str) -> list[str]:
    t = text.lower()
    return [tag for tag, kws in IMPACT_TAGS.items() if any(k in t for k in kws)]


def fetch_parseek(urls: list[str], limit: int = 60) -> list[dict]:
    """تیترهای پارسیک: لینک‌ها به شکل /u/<عدد> هستند."""
    import html as _html
    import re as _re
    out, seen = [], set()
    pat = _re.compile(r'<a[^>]+href="((?:https?://www\.parseek\.com)?/u/\d+)"[^>]*>(.*?)</a>', _re.S | _re.I)
    for url in urls:
        try:
            r = requests.get(url, headers=UA, timeout=25)
            r.raise_for_status()
            r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
        except Exception as e:  # noqa: BLE001
            log.warning("parseek failed %s: %s", url, type(e).__name__)
            continue
        for href, inner in pat.findall(r.text):
            title = _html.unescape(_re.sub(r"<[^>]+>", " ", inner))
            title = _re.sub(r"\s+", " ", title).strip()
            if len(title) < 12 or title in seen:
                continue
            seen.add(title)
            link = href if href.startswith("http") else "https://www.parseek.com" + href
            out.append({"title": title, "link": link, "published": "", "source": "پارسیک"})
            if len(out) >= limit:
                break
    return out


IRAN_RSS = ["https://www.isna.ir/rss", "https://www.irna.ir/rss", "https://www.mehrnews.com/rss",
            "https://www.khabaronline.ir/rss", "https://www.tasnimnews.com/fa/rss/feed/0/0/0"]


def fetch_news(cfg: dict) -> list[dict]:
    import feedparser
    seen, items = set(), []
    for it in fetch_parseek(cfg.get("parseek_urls", ["https://www.parseek.com/Economic/"])):
        seen.add(it["title"][:80])
        items.append(dict(it, score=_score(it["title"]), tags=_tags(it["title"])))
    urls = list(IRAN_RSS) if cfg.get("use_iran_rss", False) else []
    if cfg.get("use_google_news", False):
        for q in cfg.get("queries_fa", []):
            urls.append(f"https://news.google.com/rss/search?q={quote_plus(q)}+when:1d&hl=fa&gl=IR&ceid=IR:fa")
        for q in cfg.get("queries_en", []):
            urls.append(f"https://news.google.com/rss/search?q={quote_plus(q)}+when:1d&hl=en-US&gl=US&ceid=US:en")
    urls += cfg.get("extra_rss", [])
    lim = cfg.get("max_items_per_query", 15)
    for u in urls:
        try:
            r = requests.get(u, headers=UA, timeout=25)
            r.raise_for_status()
            feed = feedparser.parse(r.content)
        except Exception as e:  # noqa: BLE001
            log.warning("rss failed %s: %s", u.split("/")[2], type(e).__name__)
            continue
        general = "news.google" not in u
        for e in feed.entries[: (60 if general else lim)]:
            title = e.get("title", "").strip()
            key = title[:80]
            if not title or key in seen:
                continue
            if general and not _tags(title):   # از فیدهای عمومی فقط اخبار اقتصادی/سیاسی مرتبط
                continue
            seen.add(key)
            items.append({"title": title, "link": e.get("link"), "published": e.get("published", ""),
                          "score": _score(title), "tags": _tags(title)})
    return items


def news_bias(items: list[dict]) -> dict:
    """میانگین احساس خبری کلی و به تفکیک برچسب."""
    if not items:
        return {"overall": 0.0, "by_tag": {}}
    by = {}
    for it in items:
        for t in it["tags"]:
            by.setdefault(t, []).append(it["score"])
    return {"overall": round(sum(i["score"] for i in items) / len(items), 2),
            "by_tag": {k: round(sum(v) / len(v), 2) for k, v in by.items()}}
