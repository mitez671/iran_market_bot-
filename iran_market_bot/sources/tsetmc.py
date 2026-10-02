"""دریافت داده از TSETMC (بورس، فرابورس، صندوق‌ها، اوراق، اختیار معامله).

از API جدید سایت (cdn.tsetmc.com) استفاده می‌کند. اگر TSETMC ساختار پاسخ را عوض کند،
فقط همین فایل باید به‌روز شود.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests

from sources.net import HostDown

log = logging.getLogger(__name__)

BASE = "https://cdn.tsetmc.com/api"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.tsetmc.com/",
}
CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "inscodes.json"

_session = requests.Session()
_session.headers.update(HEADERS)


def normalize(s: str) -> str:
    """یکسان‌سازی حروف عربی/فارسی (ي/ی، ك/ک) و فاصله‌ها."""
    return (s or "").replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ").strip()


TIMEOUT = 15
RETRIES = 3


def _get(path: str, retries: int | None = None):
    retries = retries or RETRIES
    last = None
    for i in range(retries):
        try:
            r = _session.get(BASE + path, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except HostDown as e:
            raise RuntimeError(f"TSETMC request failed: {path} -> {e}") from e
        except Exception as e:  # noqa: BLE001
            last = e
            if i < retries - 1:
                time.sleep(2 * (i + 1))
    raise RuntimeError(f"TSETMC request failed: {path} -> {last}")


# ---------------------------------------------------------------- نماد -> کد
def _load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {}


def _save_cache(c: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")


def resolve(symbol: str) -> dict | None:
    """برمی‌گرداند: {ins_code, symbol, name}"""
    sym = normalize(symbol)
    cache = _load_cache()
    if sym in cache:
        return cache[sym]
    candidates = []
    for q in {sym, sym.replace("ی", "ي").replace("ک", "ك")}:
        try:
            data = _get(f"/Instrument/GetInstrumentSearch/{quote(q)}")
        except RuntimeError as e:
            log.warning("%s", e)
            continue
        candidates += data.get("instrumentSearch", []) or []
    exact = [c for c in candidates if normalize(c.get("lVal18AFC", "")) == sym]
    if not exact:
        log.warning("نماد پیدا نشد: %s", symbol)
        return None
    # نماد فعال‌تر: آخرین تاریخ معامله بزرگتر (اگر در پاسخ بود)
    exact.sort(key=lambda c: int(c.get("lastDate") or 0), reverse=True)
    best = exact[0]
    info = {"ins_code": str(best["insCode"]), "symbol": sym, "name": normalize(best.get("lVal30", ""))}
    cache[sym] = info
    _save_cache(cache)
    return info


# ---------------------------------------------------------------- سابقه قیمت
def history(ins_code: str, n: int = 250) -> pd.DataFrame:
    data = _get(f"/ClosingPrice/GetClosingPriceDailyList/{ins_code}/{n}")
    rows = data.get("closingPriceDaily", []) or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    out = pd.DataFrame({
        "date": pd.to_datetime(df["dEven"].astype(str), format="%Y%m%d", errors="coerce"),
        "open": df.get("priceFirst"),
        "high": df.get("priceMax"),
        "low": df.get("priceMin"),
        "close": df.get("pClosing"),       # قیمت پایانی
        "last": df.get("pDrCotVal"),       # آخرین معامله
        "yesterday": df.get("priceYesterday"),
        "volume": df.get("qTotTran5J"),
        "value": df.get("qTotCap"),
        "count": df.get("zTotTran"),
    })
    out = out.dropna(subset=["date"]).sort_values("date")
    out = out[out["volume"].fillna(0) > 0]   # روزهای بدون معامله حذف
    return out.reset_index(drop=True)


def client_type(ins_code: str) -> pd.DataFrame:
    """حقیقی/حقوقی روزانه + سرانه خرید/فروش و ورود پول حقیقی."""
    data = _get(f"/ClientType/GetClientTypeHistory/{ins_code}")
    rows = data.get("clientType", []) or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["recDate"].astype(str), format="%Y%m%d", errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    df = df.rename(columns={"buy_I_Count": "buy_CountI", "sell_I_Count": "sell_CountI"})
    for c in ["buy_I_Volume", "sell_I_Volume", "buy_N_Volume", "sell_N_Volume",
              "buy_CountI", "sell_CountI", "buy_I_Value", "sell_I_Value"]:
        if c not in df:
            df[c] = 0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df


def market_overview() -> dict:
    """شاخص کل بورس و فرابورس."""
    out = {}
    for flow, name in [(1, "bourse"), (2, "farabourse")]:
        try:
            d = _get(f"/MarketData/GetMarketOverview/{flow}").get("marketOverview", {})
            out[name] = {
                "index": d.get("indexLastValue"),
                "index_change": d.get("indexChange"),
                "value": d.get("marketActivityQTotCap"),
                "state": d.get("marketState") or d.get("marketStateTitle"),
            }
        except RuntimeError as e:
            log.warning("%s", e)
    return out


# ---------------------------------------------------------------- اختیار معامله
_OPT_RE = re.compile(r"(\d[\d,]*)\s*-\s*(1[34]\d{2}/\d{1,2}/\d{1,2})")


def parse_option_name(name: str) -> dict | None:
    """نمونه نام: «اختیارخ اهرم-24000-1405/08/14»"""
    n = normalize(name)
    m = _OPT_RE.search(n)
    if not m:
        return None
    if "اختیارخ" in n.replace(" ", ""):
        kind = "call"
    elif "اختیارف" in n.replace(" ", ""):
        kind = "put"
    else:
        return None
    # نام دارایی پایه: کلمه بعد از «اختیارخ/اختیارف» و قبل از خط تیره
    base = re.sub(r"^اختیار\s*[خف]\s*", "", n.split("-")[0]).strip()
    return {"kind": kind, "strike": float(m.group(1).replace(",", "")),
            "expiry_jalali": m.group(2), "underlying": base}


_AKHZA_RE = re.compile(r"(\d{2})(\d{2})(\d{2})\s*$")


def discover_akhza(max_items: int = 15) -> list[dict]:
    """نمادهای فعال اخزا را جستجو و سررسید را از نام استخراج می‌کند."""
    out, seen = [], set()
    for q in ["اخزا", "اخزا".replace("ی", "ي")]:
        try:
            rows = _get(f"/Instrument/GetInstrumentSearch/{quote(q)}").get("instrumentSearch", []) or []
        except RuntimeError as e:
            log.warning("%s", e); continue
        for r in rows:
            sym, name = normalize(r.get("lVal18AFC", "")), normalize(r.get("lVal30", ""))
            m = _AKHZA_RE.search(name)
            if not sym.startswith("اخزا") or not m or sym in seen:
                continue
            seen.add(sym)
            yy, mm, dd = m.groups()
            out.append({"symbol": sym, "ins_code": str(r["insCode"]), "maturity": f"14{yy}/{mm}/{dd}", "face": 1_000_000})
    return out[:max_items]
