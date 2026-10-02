"""بازارهای غیربورسی: بورس کالا (IME)، خودرو، آهن‌آلات، مسکن، مصالح و ...

- بورس کالا: سرویس رسمی آمار معاملات ime.co.ir
- بقیه: جدول‌خوان عمومی. هر منبع در config.yaml فقط یک آدرس + چند کلمه کلیدی است، پس اگر سایتی عوض شد
  بدون تغییر کد، آدرس را عوض کن.
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import date, timedelta

import pandas as pd
import requests

log = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.5"}
FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٬،", "01234567890123456789,,")


def to_num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).translate(FA_DIGITS).replace(",", "").replace("ریال", "").replace("تومان", "").strip()
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group()) if m else None


# ============================================================ بورس کالا
def ime_trades(days_back: int = 5) -> pd.DataFrame:
    """معاملات بازار فیزیکی بورس کالا (فولاد، پتروشیمی، فرآورده نفتی، سیمان، کشاورزی، فلزات)."""
    url = "https://www.ime.co.ir/subsystems/ime/services/home/imedata.asmx/GetAmareMoamelatList"
    to = date.today()
    payload = {"Language": 8, "fari": False, "GregorianFromDate": (to - timedelta(days=days_back)).strftime("%Y/%m/%d"),
               "GregorianToDate": to.strftime("%Y/%m/%d"), "MainCat": 0, "Cat": 0, "SubCat": 0, "Producer": 0}
    r = requests.post(url, json=payload, headers={**UA, "Content-Type": "application/json; charset=utf-8",
                                                  "Referer": "https://www.ime.co.ir/"}, timeout=40)
    r.raise_for_status()
    d = r.json().get("d", r.json())
    if isinstance(d, str):
        d = json.loads(d)
    df = pd.DataFrame(d)
    if df.empty:
        return df
    low = {c.lower(): c for c in df.columns}
    pick = lambda *ks: next((low[k] for k in ks if k in low), None)  # noqa: E731
    out = pd.DataFrame({
        "date": df[pick("date", "jalalidate", "tarikh")] if pick("date", "jalalidate", "tarikh") else "",
        "kala": df[pick("goodsname", "kalaname", "name")] if pick("goodsname", "kalaname", "name") else "",
        "producer": df[pick("producername", "tolidkonande")] if pick("producername", "tolidkonande") else "",
        "base_price": pd.to_numeric(df[pick("arzebaseprice", "baseprice")], errors="coerce") if pick("arzebaseprice", "baseprice") else None,
        "price": pd.to_numeric(df[pick("price", "finalprice", "avgprice")], errors="coerce") if pick("price", "finalprice", "avgprice") else None,
        "max_price": pd.to_numeric(df[pick("maxprice")], errors="coerce") if pick("maxprice") else None,
        "volume": pd.to_numeric(df[pick("quantity", "moamele", "tradevolume")], errors="coerce") if pick("quantity", "moamele", "tradevolume") else None,
        "value": pd.to_numeric(df[pick("totalprice", "totalvalue", "arzesh")], errors="coerce") if pick("totalprice", "totalvalue", "arzesh") else None,
        "group": df[pick("maingroupname", "groupname", "catname")] if pick("maingroupname", "groupname", "catname") else "",
    })
    if out["base_price"] is not None and out["price"] is not None:
        out["premium_pct"] = (out["price"] / out["base_price"] - 1) * 100   # رقابت بالای پایه = تقاضای قوی
    return out


def ime_summary(df: pd.DataFrame) -> pd.DataFrame:
    """میانگین رقابت و ارزش معاملات به تفکیک کالا — شاخص تقاضا برای گروه‌های بورسی مرتبط."""
    if df is None or df.empty or "premium_pct" not in df:
        return pd.DataFrame()
    df = df.copy()
    df["kala_short"] = df["kala"].astype(str).str.split().str[:2].str.join(" ")
    g = df.groupby("kala_short").agg(trades=("kala", "count"), avg_premium=("premium_pct", "mean"),
                                     avg_price=("price", "mean"), value=("value", "sum"))
    return g.sort_values("value", ascending=False).reset_index()


# ============================================================ جدول‌خوان عمومی (خودرو، آهن، مسکن، ...)
def scrape_tables(src: dict) -> pd.DataFrame:
    """src: {name, url, category, keep: [کلمات لازم در ردیف], min_price}
    همه جدول‌های صفحه را می‌خواند و ردیف‌هایی که یک عدد قیمت‌مانند دارند برمی‌گرداند."""
    r = requests.get(src["url"], headers=UA, timeout=30)
    r.raise_for_status()
    r.encoding = "utf-8" if (r.encoding or "").lower() in ("", "iso-8859-1") else r.encoding
    try:
        tables = pd.read_html(io.StringIO(r.text))
    except ValueError:
        tables = []
    rows = []
    keep = src.get("keep") or []
    for t in tables:
        t = t.astype(str)
        for _, row in t.iterrows():
            cells = [c for c in row.tolist() if c and c != "nan"]
            if len(cells) < 2:
                continue
            title = cells[0]
            nums = [to_num(c) for c in cells[1:]]
            nums = [n for n in nums if n and n >= src.get("min_price", 1000)]
            if not nums:
                continue
            if keep and not any(k in " ".join(cells) for k in keep):
                continue
            rows.append({"category": src.get("category", ""), "item": title[:80], "price": nums[0],
                         "detail": " | ".join(cells[1:5])[:160], "source": src.get("name", src["url"].split("/")[2])})
    if not rows:
        raise ValueError("جدول قیمت پیدا نشد (احتمالاً صفحه با جاوااسکریپت پر می‌شود)")
    return pd.DataFrame(rows).drop_duplicates(["item", "price"])


def other_markets(cfg_sources: list[dict]) -> tuple[pd.DataFrame, list[str]]:
    frames, errors = [], []
    for src in cfg_sources or []:
        try:
            frames.append(scrape_tables(src))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{src.get('category')}/{src.get('name')}: {type(e).__name__}: {str(e)[:120]}")
            log.warning("منبع %s ناموفق: %s", src.get("name"), e)
    return (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()), errors


# ============================================================ tgju: همه قیمت‌ها با برچسب
TGJU_LABELS = {
    "price_dollar_rl": "دلار آزاد", "price_eur": "یورو", "price_aed": "درهم امارات", "price_try": "لیر ترکیه",
    "price_cny": "یوان چین", "price_gbp": "پوند", "sekee": "سکه امامی", "sekeb": "سکه بهار آزادی", "nim": "نیم سکه",
    "rob": "ربع سکه", "gerami": "سکه گرمی", "geram18": "طلای ۱۸ عیار (گرم)", "geram24": "طلای ۲۴ عیار (گرم)",
    "mesghal": "مثقال طلا", "ons": "انس طلا ($)", "silver": "انس نقره ($)", "oil_brent": "نفت برنت ($)",
    "oil": "نفت WTI ($)", "crypto-bitcoin": "بیت‌کوین ($)", "crypto-ethereum": "اتریوم ($)", "crypto-tether-irr": "تتر (ریال)",
}


def tgju_all(cur: dict) -> pd.DataFrame:
    rows = []
    for k, v in (cur or {}).items():
        if not isinstance(v, dict):
            continue
        p = to_num(v.get("p"))
        if p is None:
            continue
        rows.append({"key": k, "label": TGJU_LABELS.get(k, ""), "price": p, "change_pct": to_num(str(v.get("dp", ""))),
                     "dir": v.get("dt"), "high": to_num(v.get("h")), "low": to_num(v.get("l")), "time": v.get("t")})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["group"] = df["key"].map(_tgju_group)
    return df.sort_values(["group", "label"], ascending=[True, False])


def _tgju_group(k: str) -> str:
    k = k.lower()
    if k.startswith("price_") or "dollar" in k:
        return "ارز"
    if k.startswith("seke") or k in {"nim", "rob", "gerami"} or "coin" in k:
        return "سکه"
    if "geram" in k or "mesghal" in k or "gold" in k or k == "ons":
        return "طلا"
    if k.startswith("crypto"):
        return "رمزارز"
    if "oil" in k or "gas" in k or "brent" in k:
        return "انرژی"
    if any(x in k for x in ["silver", "copper", "alum", "zinc", "nickel", "lead", "iron", "steel", "platinum", "palladium", "base_"]):
        return "فلزات"
    if "bourse" in k or "index" in k or "shakhes" in k:
        return "شاخص"
    return "سایر"
