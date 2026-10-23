"""تاریخچه روزانه دلار آزاد و طلای ۱۸ عیار از tgju (برای محاسبه «نرخ تورمی» هر معامله و ویژگی‌های مدل)."""
from __future__ import annotations

import pandas as pd
import requests

HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://www.tgju.org/"}
KEYS = {"usd": "price_dollar_rl", "gold": "geram18"}


def _series(key: str) -> pd.Series:
    r = requests.get(f"https://api.tgju.org/v1/market/indicator/summary-table-data/{key}", headers=HEADERS, timeout=40)
    r.raise_for_status()
    rows = r.json().get("data", [])
    idx = pd.to_datetime([x[6] for x in rows], format="%Y/%m/%d", errors="coerce")
    val = pd.to_numeric(pd.Series([str(x[3]).replace(",", "") for x in rows]), errors="coerce")
    s = pd.Series(val.to_numpy(), index=idx).dropna()
    return s[~s.index.duplicated()].sort_index()


def history(since: str = "2024-06-01") -> pd.DataFrame:
    """DataFrame روزانه (تقویم کامل، با پر کردن روزهای خالی) با ستون‌های usd و gold."""
    df = pd.concat({k: _series(v) for k, v in KEYS.items()}, axis=1)
    df = df[df.index >= since]
    return df.reindex(pd.date_range(df.index.min(), df.index.max())).ffill()
