"""پنل ویژگی‌ها + شبیه‌سازی معامله (حد سود/ضرر) برای بک‌تست و آموزش.

«برد» = سود خالص معامله (بعد از کارمزد و مالیات) **بیشتر از رشد میانگین دلار و طلای ۱۸ عیار** در همان دوره نگهداری.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from analysis import mlfeatures as F  # noqa: E402

# قانون معامله: ورود پایانی روز بعد از سیگنال، حد سود، حد ضرر، خروج اجباری پایانی روز H
H, TP, SL = 5, 0.04, 0.06


def sim_trade(h: pd.DataFrame, H: int = H, tp: float = TP, sl: float = SL) -> pd.DataFrame:
    """نتیجه (ناخالص) و تاریخ ورود/خروج هر معامله فرضی. اگر در یک روز هر دو حد لمس شوند، حد ضرر فرض می‌شود
    (محافظه‌کارانه)؛ خروج حد ضرر با بدترِ (سطح حد، پایانی همان روز) محاسبه می‌شود."""
    h = F.adjust(h)
    c, hi, lo = h["close"].to_numpy(float), h["high"].to_numpy(float), h["low"].to_numpy(float)
    d = h["date"].to_numpy()
    n = len(h)
    ret, ent, ext = np.full(n, np.nan), np.full(n, np.datetime64("NaT"), "datetime64[ns]"), np.full(n, np.datetime64("NaT"), "datetime64[ns]")
    for t in range(n - 1 - H):
        e = c[t + 1]
        res, xj = c[t + 1 + H] / e - 1, t + 1 + H
        for k in range(2, H + 2):
            j = t + k
            if lo[j] <= e * (1 - sl):
                res, xj = min(c[j] / e - 1, -sl), j; break
            if hi[j] >= e * (1 + tp):
                res, xj = tp, j; break
        ret[t], ent[t], ext[t] = res, d[t + 1], d[xj]
    return pd.DataFrame({"trade": ret, "entry": ent, "exit": ext}, index=h["date"])


def build(path=ROOT / "data" / "bt" / "data.pkl", fx_path=ROOT / "data" / "bt" / "fx.pkl") -> pd.DataFrame:
    d = pd.read_pickle(path)
    fx = pd.read_pickle(fx_path)
    P = F.panel(d["hist"], d["ct"], fx)
    tr = pd.concat({s: sim_trade(h) for s, h in d["hist"].items()}).reset_index()
    tr.columns = ["sym", "date", "trade", "entry", "exit"]
    P = P.merge(tr, on=["sym", "date"], how="left")
    ok = P["trade"].notna()
    P["hurdle"] = np.nan
    P.loc[ok, "hurdle"] = F.hurdle(fx, P.loc[ok, "entry"], P.loc[ok, "exit"]).to_numpy()
    P["net"] = P["trade"] - F.COST
    P["excess"] = P["net"] - P["hurdle"]                       # سود واقعی بالاتر از تورم دلار/طلا
    P["win"] = (P["excess"] > 0).astype(float).where(P["excess"].notna())
    P["win_nominal"] = (P["net"] > 0).astype(float).where(P["net"].notna())
    return P


if __name__ == "__main__":
    P = build()
    P.to_pickle(ROOT / "data" / "bt" / "panel.pkl")
    print(P.shape, P.date.min(), P.date.max(), P.sym.nunique())
