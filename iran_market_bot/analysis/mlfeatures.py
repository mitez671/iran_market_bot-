"""ویژگی‌های مدل یادگیری ماشین (هم برای بک‌تست و آموزش، هم برای اسکن زنده). هیچ ویژگی‌ای به آینده نگاه نمی‌کند."""
from __future__ import annotations

import numpy as np
import pandas as pd

from analysis.engine import macd, rsi

COST = 0.012  # کارمزد رفت‌وبرگشت + مالیات فروش (تقریبی)
EXCLUDE = ("date", "sym", "close", "liq", "trade", "entry", "exit", "hurdle", "net", "excess", "win", "win_nominal")
LABEL_PREFIX = ("fwd", "mfe", "mae", "tr_", "rk_")


def adjust(h: pd.DataFrame) -> pd.DataFrame:
    """تعدیل افزایش سرمایه/سود نقدی: قیمت پایانی TSETMC تعدیل‌نشده است ولی «قیمت دیروز» (مبنا) تعدیل‌شده است.
    بازده واقعی هر روز = پایانی / مبنا − ۱؛ سری قیمت از ضرب تجمعی ساخته می‌شود و open/high/low هم‌مقیاس می‌شوند."""
    h = h.drop_duplicates("date").sort_values("date").reset_index(drop=True).copy()
    y = h["yesterday"].astype(float).replace(0, np.nan)
    r = (h["close"].astype(float) / y - 1).fillna(h["close"].astype(float).pct_change()).fillna(0)
    adj = h["close"].iloc[-1] * (1 + r).cumprod() / (1 + r).cumprod().iloc[-1]
    k = adj / h["close"].astype(float)
    for col in ("open", "high", "low", "close", "last"):
        if col in h:
            h[col] = h[col].astype(float) * k
    return h


def symbol_features(sym: str, h: pd.DataFrame, ct: pd.DataFrame | None, horizons=(3, 5, 10)) -> pd.DataFrame:
    h = adjust(h).set_index("date").astype(float)
    c, hi, lo, v = h["close"], h["high"], h["low"], h["volume"]
    f = pd.DataFrame(index=h.index)
    f["sym"] = sym
    f["close"] = c
    f["ret1"] = c.pct_change()
    for n in (3, 5, 10, 20, 60):
        f[f"ret{n}"] = c.pct_change(n)
    f["rsi"] = rsi(c)
    m, s = macd(c)
    f["macd_h"] = (m - s) / c
    f["macd_cross_up"] = ((m > s) & (m.shift(2) <= s.shift(2))).astype(int)
    ma20, ma50 = c.rolling(20).mean(), c.rolling(50).mean()
    f["d_ma20"] = c / ma20 - 1
    f["ma20_50"] = ma20 / ma50 - 1
    f["bb_z"] = (c - ma20) / c.rolling(20).std()
    f["vol_ratio"] = v / v.shift().rolling(20).mean()
    f["val_ratio"] = h["value"] / h["value"].shift().rolling(20).mean()
    tr = pd.concat([hi - lo, (hi - c.shift()).abs(), (lo - c.shift()).abs()], axis=1).max(axis=1)
    f["atr_pct"] = tr.rolling(14).mean() / c
    f["dist_hi20"] = c / hi.rolling(20).max() - 1
    f["dist_lo20"] = c / lo.rolling(20).min() - 1
    f["close_pos"] = (c - lo) / (hi - lo).replace(0, np.nan)
    f["locked_up"] = ((c >= hi) & (f["ret1"] > 0.043)).astype(int)  # صف خرید (غیرقابل خرید)
    f["liq"] = h["value"].rolling(20).mean()
    if ct is not None and len(ct):
        k = ct.drop_duplicates("date").set_index("date")
        bpc = k["buy_I_Volume"] / k["buy_CountI"].replace(0, np.nan)
        spc = k["sell_I_Volume"] / k["sell_CountI"].replace(0, np.nan)
        pw = (bpc / spc).reindex(f.index)
        f["power"] = pw
        f["power5"] = pw.rolling(5).mean()
        net = (k["buy_I_Volume"] - k["sell_I_Volume"]).reindex(f.index) * c
        f["flow1"] = net / h["value"]
        f["flow5"] = net.rolling(5).sum() / h["value"].rolling(5).sum()
        f["flow10"] = net.rolling(10).sum() / h["value"].rolling(10).sum()
    # برچسب‌های ساده (فقط برای تحلیل؛ در زنده NaN می‌شوند)
    entry = c.shift(-1)
    for H in horizons:
        f[f"fwd{H}"] = c.shift(-1 - H) / entry - 1
    return f


def add_market(P: pd.DataFrame) -> pd.DataFrame:
    """شرایط کل بازار هر روز و قدرت نسبی نماد؛ فقط از اطلاعات همان روز و قبل از آن."""
    P = P.sort_values(["date", "sym"]).reset_index(drop=True)
    g = P.groupby("date")
    P["mkt_ret1"] = g["ret1"].transform("median")
    P["mkt_ret5"] = g["ret5"].transform("median")
    P["mkt_ret20"] = g["ret20"].transform("median")
    P["mkt_breadth"] = g["ret1"].transform(lambda x: (x > 0).mean())
    P["rel5"] = P["ret5"] - P["mkt_ret5"]
    P["rel20"] = P["ret20"] - P["mkt_ret20"]
    P["lliq"] = np.log1p(P["liq"])
    return P


def feature_cols(P: pd.DataFrame) -> list[str]:
    return [c for c in P.columns if c not in EXCLUDE and not c.startswith(LABEL_PREFIX)]


def add_fx(P: pd.DataFrame, fx: pd.DataFrame | None) -> pd.DataFrame:
    """رشد دلار و طلا تا همان روز (ویژگی‌های تورمی)؛ روز بدون قیمت با آخرین قیمت قبلی پر می‌شود."""
    cols = ["usd_ret5", "usd_ret20", "gold_ret5", "gold_ret20", "infl_ret5", "infl_ret20"]
    if fx is None or fx.empty:
        for c in cols:
            P[c] = np.nan
        return P
    f = pd.DataFrame(index=fx.index)
    for k in ("usd", "gold"):
        f[f"{k}_ret5"] = fx[k].pct_change(7)       # ۷ روز تقویمی ≈ ۵ روز کاری
        f[f"{k}_ret20"] = fx[k].pct_change(28)
    f["infl_ret5"] = (f["usd_ret5"] + f["gold_ret5"]) / 2
    f["infl_ret20"] = (f["usd_ret20"] + f["gold_ret20"]) / 2
    return P.merge(f.rename_axis("date").reset_index(), on="date", how="left")


def hurdle(fx: pd.DataFrame, entry: pd.Series, exit_: pd.Series) -> pd.Series:
    """میانگین رشد دلار و طلا بین تاریخ ورود و تاریخ خروج هر معامله (نرخ تورمی همان دوره)."""
    u, o = fx["usd"], fx["gold"]
    def at(s, d):
        return s.reindex(pd.DatetimeIndex(d), method="ffill").to_numpy()
    r_usd = at(u, exit_) / at(u, entry) - 1
    r_gold = at(o, exit_) / at(o, entry) - 1
    return pd.Series((r_usd + r_gold) / 2, index=entry.index)


def panel(hist: dict[str, pd.DataFrame], cts: dict[str, pd.DataFrame], fx: pd.DataFrame | None = None) -> pd.DataFrame:
    parts = [symbol_features(s, h, cts.get(s)) for s, h in hist.items()]
    P = pd.concat(parts).reset_index()
    P = P.rename(columns={P.columns[0]: "date"})
    return add_fx(add_market(P), fx)
