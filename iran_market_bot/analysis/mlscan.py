"""اسکن کل بازار با مدل یادگیری ماشین و انتخاب پیشنهادهای با احتمال موفقیت بالا (≥ آستانه، حداکثر N نماد در روز).

مدل با backtest/train.py ساخته می‌شود. معنی «موفقیت»: ورود با پایانی روز بعد، رسیدن به حد سود (+۴٪) یا
پایان روز پنجم با سود خالص (بعد از کارمزد و مالیات ≈ ۱٫۲٪) **بیشتر از میانگین رشد دلار و طلای ۱۸ عیار** در همان دوره، بدون برخورد با حد ضرر (−۶٪).
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from analysis import mlfeatures as F
from analysis.engine import Signal
from sources import fxhist
from sources import tsetmc as T

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "data" / "ml_model.pkl"
CACHE = ROOT / "data" / "ml_scan.json"
TEHRAN = timezone(timedelta(hours=3, minutes=30))
STOCK_CATS = ["سهام", "صندوق سهامی/مختلط", "صندوق طلا و کالا", "صندوق اهرمی"]
HIST_DAYS = 160


def _fetch(row):
    code, sym = str(row["ins_code"]), row["symbol"]
    try:
        h = T.history(code, HIST_DAYS)
        if len(h) < 70:
            return sym, None, None
        try:
            ct = T.client_type(code)
        except Exception:  # noqa: BLE001
            ct = pd.DataFrame()
        return sym, h, ct
    except Exception as e:  # noqa: BLE001
        log.debug("%s: %s", sym, e)
        return sym, None, None


def _drop_partial_today(h: pd.DataFrame, now: datetime) -> pd.DataFrame:
    """اگر بازار هنوز باز است، ردیف ناقص امروز حذف شود تا ویژگی‌ها مثل زمان آموزش (روز کامل) باشند."""
    if len(h) and h["date"].iloc[-1].date() == now.date() and now.strftime("%H:%M") < "13:00":
        return h.iloc[:-1]
    return h


def load_model():
    return pd.read_pickle(MODEL) if MODEL.exists() else None


def scan(mw: pd.DataFrame, cfg: dict | None = None, workers: int = 6) -> dict:
    """خروجی: {picks: [Signal], probs: {نماد: احتمال}, asof: تاریخ آخرین روز کامل، info: متن وضعیت}"""
    cfg = cfg or {}
    mdl = load_model()
    if mdl is None:
        raise RuntimeError("مدل ML پیدا نشد؛ اول `python -m backtest.train` را اجرا کن")
    now = datetime.now(TEHRAN)
    ttl = cfg.get("cache_minutes", 120)
    if CACHE.exists() and ttl:
        try:
            c = json.loads(CACHE.read_text(encoding="utf-8"))
            if (now - datetime.fromisoformat(c["scanned_at"])).total_seconds() < ttl * 60:
                c["picks"] = [Signal(**s) for s in c["picks"]]
                c["info"] += " (کش)"
                return c
        except Exception:  # noqa: BLE001
            pass
    u = mw[mw["category"].isin(STOCK_CATS) & (mw["value"] > cfg.get("min_today_value", 3e10))]
    u = u.sort_values("value", ascending=False).head(cfg.get("universe", 450))
    hist, cts = {}, {}
    with ThreadPoolExecutor(workers) as ex:
        for sym, h, ct in ex.map(_fetch, [r for _, r in u.iterrows()]):
            if h is None:
                continue
            h = _drop_partial_today(h, now)
            if len(h) >= 70:
                hist[sym] = h
                if isinstance(ct, pd.DataFrame) and len(ct):
                    cts[sym] = ct
    if not hist:
        raise RuntimeError("داده تاریخی هیچ نمادی دریافت نشد")
    fx = fxhist.history()  # دلار و طلای ۱۸ از tgju: ویژگی‌های تورمی مدل
    P = F.panel(hist, cts, fx)
    last_day = P["date"].max()
    cur = P[P["date"] == last_day].copy()
    for col in mdl["feats"]:
        if col not in cur:
            cur[col] = float("nan")
    cur["p"] = mdl["model"].predict_proba(cur[mdl["feats"]])[:, 1]
    probs = {T.normalize(r.sym): float(r.p) for r in cur.itertuples()}
    ok = cur[(cur["locked_up"] == 0) & (cur["liq"] > mdl["min_liq"]) & (cur["p"] >= mdl["th"])]
    ok = ok.sort_values("p", ascending=False).head(cfg.get("top_n", 5))
    bt = mdl.get("backtest", {})
    picks = []
    for r in ok.itertuples():
        raw_close = float(hist[r.sym]["close"].iloc[-1])
        why = [f"احتمال اینکه سود خالص از رشد دلار/طلا بیشتر شود: {r.p*100:.0f}٪ (آستانه {mdl['th']*100:.0f}٪)",
               f"خرید فردا، حد سود +{mdl['tp']*100:.0f}٪، حد ضرر −{mdl['sl']*100:.0f}٪، خروج حداکثر روز {mdl['h']}م",
               f"RSI={r.rsi:.0f} | رشد ۵روزه {r.ret5*100:+.1f}٪ | حجم {r.vol_ratio:.1f}× میانگین"]
        if pd.notna(getattr(r, "power5", float("nan"))):
            why.append(f"قدرت خریدار حقیقی (۵روزه) {r.power5:.2f}")
        if bt:
            why.append(f"بک‌تست {bt['from']}→{bt['to']}: نرخ برد (بالاتر از تورم) پیشنهادهای مشابه {bt['win']*100:.0f}٪")
        picks.append(Signal(r.sym, "سهام (ML)", "BUY", round(r.p * 10, 1), raw_close, why,
                            stop=round(raw_close * (1 - mdl["sl"])), target=round(raw_close * (1 + mdl["tp"])),
                            extra={"p": round(r.p, 3)}))
    out = {"picks": picks, "probs": probs, "asof": str(last_day.date()), "scanned_at": now.isoformat(),
           "info": f"{len(hist)} نماد اسکن شد، آخرین روز کامل {last_day.date()}، {len(picks)} پیشنهاد"}
    try:
        CACHE.write_text(json.dumps({**out, "picks": [s.__dict__ for s in picks]}, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        log.warning("ذخیره کش اسکن ناموفق: %s", e)
    return out
