"""دیده‌بان کامل بازار (همه نمادهای بورس، فرابورس، صندوق‌ها، اخزا، گام، صکوک، اختیار، آتی، گواهی سپرده)
+ شاخص‌های بخشی + طبقه‌بندی + غربالگری کل بازار.

دو منبع: MarketWatchPlus (old.tsetmc.com، همه نمادها در یک درخواست) و در صورت خطا GetMarketWatch در cdn.tsetmc.com.
"""
from __future__ import annotations

import logging
import re

import pandas as pd
import requests

from .tsetmc import HEADERS, _get, normalize

log = logging.getLogger(__name__)

FLOW = {1: "بورس", 2: "فرابورس", 3: "مشتقه", 4: "پایه فرابورس", 5: "پایه فرابورس", 6: "بورس انرژی", 7: "بورس کالا"}


# ============================================================ دریافت
def _watch_old() -> pd.DataFrame:
    r = requests.get("http://old.tsetmc.com/tsev2/data/MarketWatchPlus.aspx", params={"h": 0, "r": 0},
                     headers=HEADERS, timeout=20)
    r.raise_for_status()
    sec = r.text.split("@")
    rows = []
    for row in sec[2].split(";"):
        c = row.split(",")
        if len(c) < 23:
            continue
        rows.append({"ins_code": c[0], "symbol": normalize(c[2]), "name": normalize(c[3]),
                     "open": float(c[5]), "close": float(c[6]), "last": float(c[7]), "count": float(c[8]),
                     "volume": float(c[9]), "value": float(c[10]), "low": float(c[11]), "high": float(c[12]),
                     "yesterday": float(c[13]), "eps": float(c[14]) if c[14] else None, "base_volume": float(c[15]),
                     "flow": int(c[17]), "group": c[18], "range_max": float(c[19]), "range_min": float(c[20]),
                     "shares": float(c[21])})
    df = pd.DataFrame(rows)
    # سرخط سفارش‌ها
    best = {}
    for row in (sec[3].split(";") if len(sec) > 3 else []):
        c = row.split(",")
        if len(c) == 8 and c[1] == "1":
            best[c[0]] = {"bid": float(c[4]), "ask": float(c[5]), "bid_vol": float(c[6]), "ask_vol": float(c[7])}
    if not df.empty and best:
        b = pd.DataFrame.from_dict(best, orient="index")
        df = df.join(b, on="ins_code")
    return df


def _watch_cdn() -> pd.DataFrame:
    q = "&".join(f"paperTypes%5B{i}%5D={t}" for i, t in enumerate(range(1, 9)))
    d = _get(f"/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&{q}&showTraded=false&withBestLimits=true&hEven=0&RefID=0")
    items = d.get("marketwatch") or d.get("marketWatch") or []
    rows = []
    for it in items:
        g = lambda *ks: next((it[k] for k in ks if k in it and it[k] is not None), None)  # noqa: E731
        bl = (g("blDs") or [{}])[0] if isinstance(g("blDs"), list) else {}
        rows.append({"ins_code": str(g("insCode", "inscode")), "symbol": normalize(g("lva", "lVal18AFC") or ""),
                     "name": normalize(g("lvc", "lVal30") or ""), "open": g("pf", "priceFirst"),
                     "close": g("pcl", "pClosing"), "last": g("pdv", "pDrCotVal"), "count": g("ztt", "zTotTran"),
                     "volume": g("qtj", "qTotTran5J"), "value": g("qtc", "qTotCap"), "low": g("pmn", "priceMin"),
                     "high": g("pmx", "priceMax"), "yesterday": g("py", "priceYesterday"), "eps": g("eps"),
                     "base_volume": g("bv", "baseVol"), "flow": g("flow", "cComVal"), "group": g("cs", "cSecVal"),
                     "range_max": g("tmax", "psGelStaMax"), "range_min": g("tmin", "psGelStaMin"),
                     "shares": g("z", "zTitad"), "bid": bl.get("pmd"), "ask": bl.get("pmo"),
                     "bid_vol": bl.get("qmd"), "ask_vol": bl.get("qmo")})
    return pd.DataFrame(rows)


def _client_all() -> pd.DataFrame:
    r = requests.get("http://old.tsetmc.com/tsev2/data/ClientTypeAll.aspx", headers=HEADERS, timeout=30)
    r.raise_for_status()
    rows = []
    for row in r.text.split(";"):
        c = row.split(",")
        if len(c) != 9:
            continue
        rows.append({"ins_code": c[0], "r_buy_n": float(c[1]), "r_buy_v": float(c[3]),
                     "r_sell_n": float(c[5]), "r_sell_v": float(c[7]), "l_buy_v": float(c[4]), "l_sell_v": float(c[8])})
    return pd.DataFrame(rows)


def market_watch() -> pd.DataFrame:
    df, src = pd.DataFrame(), ""
    for fn, name in [(_watch_old, "old.tsetmc"), (_watch_cdn, "cdn.tsetmc")]:
        try:
            df = fn()
            if not df.empty:
                src = name
                break
        except Exception as e:  # noqa: BLE001
            log.warning("دیده‌بان از %s ناموفق: %s", name, e)
    if df.empty:
        raise RuntimeError("دیده‌بان بازار در دسترس نیست")
    for c in ["open", "close", "last", "count", "volume", "value", "low", "high", "yesterday", "base_volume",
              "range_max", "range_min", "shares", "eps"]:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    try:
        ct = _client_all()
        if not ct.empty:
            df = df.merge(ct, on="ins_code", how="left")
    except Exception as e:  # noqa: BLE001
        log.warning("حقیقی/حقوقی کل بازار ناموفق: %s", e)
    df["source"] = src
    df["category"] = df.apply(lambda r: classify(r["symbol"], r["name"]), axis=1)
    df["market"] = df["flow"].map(lambda f: FLOW.get(int(f), str(f)) if pd.notna(f) else "")
    import numpy as np
    for c in ["r_buy_n", "r_buy_v", "r_sell_n", "r_sell_v", "volume", "base_volume", "yesterday", "close", "last", "eps"]:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype(float)
    nz = lambda x: x.where(x != 0)  # noqa: E731  صفر → NaN (تقسیم بر صفر نمی‌شود)
    y = nz(df["yesterday"])
    df["chg_last"] = (df["last"] / y - 1) * 100
    df["chg_close"] = (df["close"] / y - 1) * 100
    df["pe"] = df["close"] / df["eps"].where(df["eps"] > 0)
    if "r_buy_v" in df:
        bpc = df["r_buy_v"] / nz(df["r_buy_n"])
        spc = df["r_sell_v"] / nz(df["r_sell_n"])
        df["buyer_power"] = (bpc / nz(spc)).replace([np.inf, -np.inf], np.nan)
        df["real_flow_bn_toman"] = (df["r_buy_v"] - df["r_sell_v"]) * df["close"] / 1e10
    df["vol_ratio"] = df["volume"] / nz(df["base_volume"])
    zero = pd.Series(0.0, index=df.index)
    ask_v = df["ask_vol"].fillna(0) if "ask_vol" in df else zero
    bid_v = df["bid_vol"].fillna(0) if "bid_vol" in df else zero
    df["buy_queue"] = (df["last"] >= df["range_max"]) & (ask_v == 0) & (df["range_max"] > 0)
    df["sell_queue"] = (df["last"] <= df["range_min"]) & (bid_v == 0) & (df["range_min"] > 0)
    return df


# ============================================================ طبقه‌بندی
def classify(symbol: str, name: str) -> str:
    s, n = symbol or "", name or ""
    if n.startswith("اختیارخ") or n.startswith("اختیار خ"):
        return "اختیار خرید"
    if n.startswith("اختیارف") or n.startswith("اختیار ف"):
        return "اختیار فروش"
    if "آتی" in n:
        return "آتی"
    if s.startswith("اخزا") or "اسناد خزانه" in n or "اسنادخزانه" in n:
        return "اسناد خزانه (اخزا)"
    if s.startswith("گام") or "اعتبار مولد" in n:
        return "اوراق گام"
    if any(k in n for k in ["مرابحه", "اجاره", "منفعت", "مشارکت", "صکوک", "سلف", "استصناع", "رهنی", "خرید دین"]):
        return "صکوک و اوراق بدهی"
    if "گواهی سپرده" in n or "گواهی‌سپرده" in n:
        return "گواهی سپرده کالا"
    if "صندوق" in n or s in {"طلا", "عیار", "کهربا", "زر", "گنج", "مثقال", "نفیس", "ناب"}:
        if any(k in n for k in ["طلا", "کالا", "زر", "سکه"]):
            return "صندوق طلا و کالا"
        if "اهرم" in n:
            return "صندوق اهرمی"
        if any(k in n for k in ["درآمد ثابت", "ثابت", "اندوخته", "سپر"]):
            return "صندوق درآمد ثابت"
        return "صندوق سهامی/مختلط"
    if s.endswith("ح") and len(s) > 2:
        return "حق تقدم"
    return "سهام"


# ============================================================ شاخص‌ها
def indices() -> pd.DataFrame:
    rows = []
    for path, kind in [("/Index/GetIndexB1LastAll/SelectedIndexes/1", "منتخب"), ("/Index/GetIndexB1LastAll/All/1", "صنعت")]:
        try:
            d = _get(path)
        except RuntimeError as e:
            log.warning("%s", e); continue
        for it in d.get("indexB1", []) or []:
            rows.append({"kind": kind, "ins_code": str(it.get("insCode")), "name": normalize(it.get("lVal30", "")),
                         "value": it.get("xDrNivJIdx004"), "change": it.get("indexChange"),
                         "chg_pct": it.get("xVarIdxJRfV"), "high": it.get("xPhNivJIdx004"), "low": it.get("xPbNivJIdx004")})
    df = pd.DataFrame(rows)
    return df.drop_duplicates("ins_code") if not df.empty else df


# ============================================================ اوراق
_GAM_RE = re.compile(r"(\d{2})(\d{2})$")


def bond_table(mw: pd.DataFrame, today, jalali_to_gregorian, bench: float | None = None) -> pd.DataFrame:
    """بازده اخزا (سررسید از نام) و تخمین بازده گام (سررسید از نماد، پایان ماه)."""
    out = []
    for _, r in mw[mw["category"].isin(["اسناد خزانه (اخزا)", "اوراق گام"])].iterrows():
        price = r["close"] if r["close"] and r["close"] > 0 else r["last"]
        if not price or price <= 0:
            continue
        mat, note = None, ""
        try:
            if r["category"] == "اسناد خزانه (اخزا)":
                m = re.search(r"(\d{2})(\d{2})(\d{2})\s*$", r["name"])
                if m:
                    mat = jalali_to_gregorian(f"14{m.group(1)}/{m.group(2)}/{m.group(3)}")
            else:
                m = _GAM_RE.search(r["symbol"])
                if m:
                    yy, mm = int(m.group(1)), int(m.group(2))
                    if 1 <= mm <= 12:
                        mat = jalali_to_gregorian(f"14{yy:02d}/{mm:02d}/{29 if mm == 12 else 30 if mm > 6 else 31}")
                        note = "سررسید تخمینی (پایان ماه)"
        except Exception:  # noqa: BLE001
            mat = None
        face = 1_000_000
        row = {"symbol": r["symbol"], "category": r["category"], "name": r["name"], "price": price,
               "value_bn": (r["value"] or 0) / 1e10, "maturity": mat, "note": note}
        if mat and 0.3 * face <= price <= 1.05 * face:
            days = (mat - today).days
            if days > 0:
                row["days"] = days
                row["ytm"] = ((face / price) ** (365 / days) - 1) * 100
        out.append(row)
    df = pd.DataFrame(out)
    if df.empty or "ytm" not in df:
        return df
    ref = df[(df["category"] == "اسناد خزانه (اخزا)") & (df["days"] >= 30)]["ytm"].median()
    ref = bench * 100 if bench and pd.isna(ref) else ref
    df["vs_market"] = df["ytm"] - ref
    df.attrs["benchmark"] = ref
    return df.sort_values("ytm", ascending=False)


# ============================================================ غربالگری کل بازار
def screen(mw: pd.DataFrame) -> dict[str, pd.DataFrame]:
    st = mw[mw["category"].isin(["سهام", "حق تقدم"]) & (mw["value"] > 0)].copy()
    cols = ["symbol", "name", "market", "close", "chg_close", "value", "buyer_power", "real_flow_bn_toman", "vol_ratio", "pe"]
    cols = [c for c in cols if c in st]
    res = {
        "بیشترین رشد": st.nlargest(15, "chg_close")[cols],
        "بیشترین افت": st.nsmallest(15, "chg_close")[cols],
        "بیشترین ارزش معاملات": st.nlargest(15, "value")[cols],
        "صف خرید": st[st["buy_queue"]][cols].head(30),
        "صف فروش": st[st["sell_queue"]][cols].head(30),
        "حجم مشکوک (بیش از ۲ برابر حجم مبنا)": st[st["vol_ratio"] > 2].nlargest(20, "vol_ratio")[cols],
    }
    if "real_flow_bn_toman" in st:
        res["ورود پول حقیقی"] = st.nlargest(15, "real_flow_bn_toman")[cols]
        res["خروج پول حقیقی"] = st.nsmallest(15, "real_flow_bn_toman")[cols]
        strong = st[(st["buyer_power"] >= 2) & (st["real_flow_bn_toman"] > 0) & (st["chg_close"] < 4)]
        res["قدرت خریدار بالا بدون رشد زیاد قیمت (فرصت احتمالی)"] = strong.nlargest(20, "buyer_power")[cols]
    return res


def market_breadth(mw: pd.DataFrame) -> dict:
    st = mw[mw["category"] == "سهام"]
    st = st[st["value"] > 0]
    out = {"positive": int((st["chg_close"] > 0).sum()), "negative": int((st["chg_close"] < 0).sum()),
           "buy_queues": int(st["buy_queue"].sum()), "sell_queues": int(st["sell_queue"].sum()),
           "total_value_bn_toman": round(float(mw["value"].sum()) / 1e10, 0)}
    if "real_flow_bn_toman" in st:
        out["real_flow_bn_toman"] = round(float(st["real_flow_bn_toman"].sum()), 0)
    by_cat = mw.groupby("category").agg(n=("symbol", "count"), value=("value", "sum"))
    out["by_category"] = {k: {"count": int(v["n"]), "value_bn_toman": round(v["value"] / 1e10, 1)} for k, v in by_cat.iterrows()}
    return out
