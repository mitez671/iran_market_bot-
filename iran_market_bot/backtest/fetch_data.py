"""دانلود تاریخچه روزانه + حقیقی/حقوقی بازار برای بک‌تست (ذخیره در data/bt/)."""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from sources import tsetmc as T  # noqa: E402

OUT = ROOT / "data" / "bt"
N_DAYS = 420
MIN_VALUE = 3e10  # حداقل ارزش معاملات امروز (ریال) برای ورود به جهان بک‌تست


def one(row):
    code, sym = str(row["ins_code"]), row["symbol"]
    try:
        h = T.history(code, N_DAYS)
        if len(h) < 120:
            return sym, None, None
        try:
            ct = T.client_type(code)
        except Exception:  # noqa: BLE001
            ct = pd.DataFrame()
        return sym, h, ct
    except Exception as e:  # noqa: BLE001
        return sym, None, str(e)


def main():
    mw = pd.read_pickle(OUT / "mw.pkl")
    u = mw[(mw.category.isin(["سهام", "صندوق سهامی/مختلط", "صندوق طلا و کالا", "صندوق اهرمی"])) & (mw.value > MIN_VALUE)]
    u = u.sort_values("value", ascending=False).head(450)
    print("universe", len(u), flush=True)
    hist, cts = {}, {}
    with ThreadPoolExecutor(6) as ex:
        for i, (sym, h, ct) in enumerate(ex.map(one, [r for _, r in u.iterrows()])):
            if isinstance(h, pd.DataFrame):
                hist[sym] = h
                if isinstance(ct, pd.DataFrame) and len(ct):
                    cts[sym] = ct
            if i % 50 == 0:
                print(i, len(hist), flush=True)
    pd.to_pickle({"hist": hist, "ct": cts}, OUT / "data.pkl")
    print("saved", len(hist), len(cts))


if __name__ == "__main__":
    main()
