"""بک‌تست walk-forward روی یک ماه آخر (و ماه‌های قبل) + آموزش مدل نهایی.

اجرا (از پوشه پروژه):
    python backtest/fetch_data.py     # دانلود داده (ماهی یک بار یا هر وقت خواستی)
    python backtest/train.py          # بک‌تست + ذخیره data/ml_model.pkl
"""
from __future__ import annotations

import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from analysis import mlfeatures as F  # noqa: E402
from backtest import features as BF  # noqa: E402

warnings.filterwarnings("ignore")
TH = 0.80          # آستانه احتمال موفقیت برای اعلام «خرید»
MIN_LIQ = 5e10     # میانگین ۲۰ روزه ارزش معاملات (ریال)
GAP = pd.Timedelta(days=BF.H + 4)  # فاصله بین آموزش و تست تا نتیجه معاملات آموزش به تست نشت نکند


def new_model():
    return HistGradientBoostingClassifier(max_depth=4, learning_rate=0.05, max_iter=200,
                                          min_samples_leaf=200, l2_regularization=5)


def usable(P):
    return P[(P.locked_up == 0) & (P.liq > MIN_LIQ)]


def walk_forward(P, feats, start="2026-06", end=None):
    """هر ماه را فقط با داده‌های قبل از آن آموزش می‌دهد و روی همان ماه تست می‌کند."""
    d = usable(P)
    d = d[d.win.notna()]
    rows, picks = [], []
    for mo in pd.period_range(start, end or d.date.max().to_period("M"), freq="M"):
        te = d[(d.date >= mo.start_time) & (d.date <= mo.end_time)]
        tr = d[d.date < mo.start_time - GAP]
        if len(te) < 200 or len(tr) < 15000:
            continue
        m = new_model().fit(tr[feats], tr.win)
        te = te.assign(p=m.predict_proba(te[feats])[:, 1])
        k = te[te.p >= TH]
        picks.append(k)
        rows.append((str(mo), len(te), te.win.mean(), len(k), k.win.mean() if len(k) else np.nan,
                     k.net.mean() if len(k) else np.nan, k.date.nunique()))
    return pd.DataFrame(rows, columns=["ماه", "نمونه_کل", "نرخ_برد_پایه", "تعداد_پیشنهاد", "نرخ_برد_پیشنهادها", "میانگین_سود_خالص", "روزهای_سیگنال"]), \
        (pd.concat(picks) if picks else pd.DataFrame())


def last_month_test(P, feats):
    """تست اصلی: آخرین ~۳۰ روز تقویمی که نتیجه‌شان معلوم است؛ مدل فقط با داده قبل از آن آموزش دیده."""
    d = usable(P)
    d = d[d.win.notna()]
    end = d.date.max()
    start = end - pd.Timedelta(days=30)
    tr, te = d[d.date < start - GAP], d[d.date >= start]
    m = new_model().fit(tr[feats], tr.win)
    te = te.assign(p=m.predict_proba(te[feats])[:, 1])
    k = te[te.p >= TH]
    return start, end, te, k


def main():
    P = BF.build()
    P.to_pickle(ROOT / "data" / "bt" / "panel.pkl")
    feats = F.feature_cols(P)
    print(f"داده: {P.date.min().date()} → {P.date.max().date()} | {P.sym.nunique()} نماد | {len(feats)} ویژگی")

    start, end, te, k = last_month_test(P, feats)
    print(f"\n===== تست یک ماه اخیر ({start.date()} تا {end.date()}) — آموزش فقط با داده قبل از {start.date()} =====")
    print(f"اگر هر نمادی را می‌خریدی: سود اسمی مثبت {te.win_nominal.mean()*100:.1f}% | بالاتر از تورم دلار/طلا {te.win.mean()*100:.1f}%  (n={len(te)}) | میانگین تورم دوره {te.hurdle.mean()*100:.2f}%")
    print(f"پیشنهادهای مدل (احتمال≥{TH}): n={len(k)} در {k.date.nunique()} روز، {k.sym.nunique()} نماد | "
          f"نرخ برد (بالاتر از تورم) {k.win.mean()*100:.1f}% | سود اسمی مثبت {k.win_nominal.mean()*100:.1f}% | میانگین سود خالص هر معامله {k.net.mean()*100:+.2f}% | "
          f"سود‌ده‌ترین/زیان‌ده‌ترین {k.net.max()*100:+.1f}/{k.net.min()*100:+.1f}%")
    pf = k.net[k.net > 0].sum() / abs(k.net[k.net < 0].sum()) if (k.net < 0).any() else float("inf")
    print(f"Profit factor: {pf:.2f}")
    by_day = k.groupby("date").agg(n=("win", "size"), win=("win", "mean"))
    print("نرخ برد روزانه (روزهای سیگنال):", f"میانه {by_day.win.median()*100:.0f}% | کمینه {by_day.win.min()*100:.0f}%")
    # فقط ۵ پیشنهاد برتر هر روز — واقع‌بینانه‌تر چون کسی ۴۰ سهم را با هم نمی‌خرد
    top = k.sort_values(["date", "p"], ascending=[True, False]).groupby("date").head(5)
    print(f"۵ پیشنهاد برتر هر روز: n={len(top)} نرخ برد {top.win.mean()*100:.1f}% میانگین {top.net.mean()*100:+.2f}%")

    print("\n===== walk-forward ماه‌به‌ماه =====")
    wf, _ = walk_forward(P, feats, "2025-06")
    print(wf.round(3).to_string(index=False))

    d = usable(P)
    d = d[d.win.notna()]
    final = new_model().fit(d[feats], d.win)
    pd.to_pickle({"model": final, "feats": feats, "th": TH, "h": BF.H, "tp": BF.TP, "sl": BF.SL, "min_liq": MIN_LIQ,
                  "trained_through": str(P.date.max().date()),
                  "backtest": {"win": float(top.win.mean()), "n": int(len(top)), "avg": float(top.net.mean()),
                               "base": float(te.win.mean()), "from": str(start.date()), "to": str(end.date())}},
                 ROOT / "data" / "ml_model.pkl")
    print("\nمدل نهایی ذخیره شد: data/ml_model.pkl")


if __name__ == "__main__":
    main()
