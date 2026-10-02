"""سامانه پایش و سیگنال‌دهی بازارهای ایران + اثر بازارهای جهانی.

اجرا:
    python main.py --once      # یک بار اجرا
    python main.py --loop      # اجرای دوره‌ای طبق config.yaml
    python main.py --demo      # تست آفلاین با داده ساختگی
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from analysis import engine as E
from analysis import output as O
from sources import others as S
from sources import tsetmc as T
from sources import pricestore as P
from sources import market as M
from sources import news as N
from sources import commodity as C
from sources import net as NET
from analysis import nlp as NL
from analysis import dashboard as D

ROOT = Path(__file__).resolve().parent
TEHRAN = timezone(timedelta(hours=3, minutes=30))
(ROOT / "reports").mkdir(exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S",
                    handlers=[logging.StreamHandler(),
                              logging.FileHandler(ROOT / "reports" / "main_log.txt", encoding="utf-8")])
log = logging.getLogger("main")


def jalali_to_gregorian(s: str) -> date:
    jy, jm, jd = (int(x) for x in s.replace("-", "/").split("/"))
    jy += 1595
    days = -355668 + 365 * jy + (jy // 33) * 8 + ((jy % 33) + 3) // 4 + jd + ((jm - 1) * 31 if jm < 7 else (jm - 7) * 30 + 186)
    gy = 400 * (days // 146097); days %= 146097
    if days > 36524:
        days -= 1; gy += 100 * (days // 36524); days %= 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461); days %= 1461
    if days > 365:
        gy += (days - 1) // 365; days = (days - 1) % 365
    gd = days + 1
    ml = [0, 31, 29 if (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 0
    while gm < 13 and gd > ml[gm]:
        gd -= ml[gm]; gm += 1
    return date(gy, gm, gd)


def safe(fn, *a, default=None, what=""):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001
        log.warning("خطا در %s: %s", what or fn.__name__, e)
        return default


# ============================================================ یک چرخه کامل
def run_cycle(cfg: dict) -> list:
    NET.reset()
    today = datetime.now(TEHRAN).date()
    sc, wl = cfg["signals"], cfg["watchlist"]
    status: dict[str, str] = {}

    def get(name, fn, *a, default=None, ok=lambda r: ""):
        t0 = time.time()
        try:
            r = fn(*a)
            status[name] = f"✅ {ok(r)} ({time.time()-t0:.0f}s)".replace(" ()", "")
            return r
        except Exception as e:  # noqa: BLE001
            status[name] = f"❌ {type(e).__name__}: {str(e)[:120]}"
            log.warning("خطا در %s: %s", name, e)
            return default

    log.info("۱/۷ قیمت طلا، سکه، ارز و بازار جهانی (tgju)…")
    local = get("tgju", S.fetch_tgju, cfg["tgju_keys"], default={}, ok=lambda r: f"{len(S._TGJU_CUR)} قیمت")
    tgju_df = C.tgju_all(S._TGJU_CUR)
    glob_raw = get("Yahoo (اختیاری، با VPN)", S.fetch_global, cfg["global_tickers"], default={},
                   ok=lambda r: f"{len(r)} نماد") if cfg.get("use_yahoo", True) else {}
    glob = E.global_summary(glob_raw or {})
    for name, v in (S.tgju_global() or {}).items():
        if name not in glob:
            glob[name] = {"last": v["price"], "chg_1d": v["change_pct"],
                          "chg_5d": P.change_pct(name, v["price"], 7), "chg_20d": P.change_pct(name, v["price"], 28),
                          "trend": "نامشخص", "rsi": None, "source": f"tgju:{v['key']}"}
    if "ounce" not in local and "gold_ounce" in glob:
        local["ounce"] = {"price": glob["gold_ounce"]["last"], "change_pct": glob["gold_ounce"]["chg_1d"]}
    usd_chg = (local.get("usd_irr") or {}).get("change_pct")

    log.info("۲/۷ دیده‌بان کامل بورس و فرابورس و شاخص‌ها…")
    mw = get("دیده‌بان کامل TSETMC", M.market_watch, default=pd.DataFrame(), ok=lambda r: f"{len(r)} نماد")
    idx = get("شاخص‌های بخشی", M.indices, default=pd.DataFrame(), ok=lambda r: f"{len(r)} شاخص")
    overview = get("شاخص کل", T.market_overview, default={}, ok=lambda r: "")
    breadth = M.market_breadth(mw) if not mw.empty else {}
    screens = M.screen(mw) if not mw.empty else {}

    log.info("۳/۷ اخبار از چند سایت + کدال…")
    news, news_status = get("اخبار", N.fetch_all, cfg["news"].get("sites"), default=([], {}),
                            ok=lambda r: f"{len(r[0])} تیتر")
    for k, v in news_status.items():
        status[f"  خبر: {k}"] = f"✅ {v} تیتر" if isinstance(v, int) else f"❌ {v}"
    codal = get("کدال (اطلاعیه ناشران)", N.codal_latest, default=[], ok=lambda r: f"{len(r)} اطلاعیه")

    log.info("۴/۷ بورس کالا، خودرو، آهن‌آلات، مسکن…")
    ime = get("بورس کالا (IME)", C.ime_trades, default=pd.DataFrame(), ok=lambda r: f"{len(r)} معامله")
    ime_sum = C.ime_summary(ime)
    other, other_err = C.other_markets(cfg.get("other_markets", []))
    for src in cfg.get("other_markets", []):
        key = f"  {src.get('category')}: {src.get('name')}"
        n = int((other["source"] == src.get("name")).sum()) if not other.empty else 0
        status[key] = f"✅ {n} قلم" if n else "❌ " + next((e.split(": ", 1)[1] for e in other_err if src.get("name") in e), "بدون داده")

    log.info("۵/۷ تحلیل هوشمند اخبار…")
    names = dict(zip(mw["symbol"], mw["name"])) if not mw.empty else {}
    names = {k: v for k, v in names.items() if k and len(k) >= 3}
    nlp = get("تحلیل اخبار", NL.analyze, news, names, P, cfg.get("nlp", {}), default={"impact": {}, "themes": {}},
              ok=lambda r: f"{r.get('n_relevant', 0)} خبر اثرگذار")
    news_score = (nlp.get("impact") or {}).get("بورس", 0.0)

    # ذخیره تاریخچه برای محاسبه تغییرات و آموزش مدل اخبار
    tedpix = (overview.get("bourse") or {}).get("index")
    safe(P.save, {**{k: v["last"] for k, v in glob.items()}, **{k: v.get("price") for k, v in local.items()},
                  "tedpix": tedpix, "ifx": (overview.get("farabourse") or {}).get("index")}, what="ذخیره قیمت‌ها")

    log.info("۶/۷ سیگنال‌های دیده‌بان شخصی…")
    signals = []
    cache_hist = {}
    for market, syms in [("سهام", wl.get("stocks", [])), ("صندوق", wl.get("funds", []))]:
        for sym in syms:
            info = safe(T.resolve, sym, what=f"جستجوی {sym}")
            if not info:
                continue
            df = safe(T.history, info["ins_code"], sc["history_days"], default=pd.DataFrame(), what=f"سابقه {sym}")
            if df.empty:
                continue
            cache_hist[T.normalize(sym)] = df
            ct = safe(T.client_type, info["ins_code"], default=None, what=f"حقیقی/حقوقی {sym}")
            inter = E.intermarket_score(T.normalize(sym), cfg.get("sensitivity", {}), glob, usd_chg)
            sig = E.stock_signal(sym, market, df, ct, inter, news_score, sc["min_score"])
            for h in (nlp.get("by_symbol") or {}).get(T.normalize(sym), [])[:2]:
                sig.reasons.append(f"خبر: {h[:70]}")
            signals.append(sig)
            time.sleep(0.3)

    # اوراق: اخزا و گام از دیده‌بان کامل
    bonds = M.bond_table(mw, today, jalali_to_gregorian) if not mw.empty else pd.DataFrame()
    bench = bonds.attrs.get("benchmark") if not bonds.empty else None
    cfg["_bench"] = (bench / 100) if bench and cfg.get("benchmark_rate", "auto") == "auto" else \
        (cfg["benchmark_rate"] if isinstance(cfg.get("benchmark_rate"), (int, float)) else 0.35)
    margin = cfg.get("bond_margin", 0.015) * 100
    if not bonds.empty and "vs_market" in bonds:
        for _, b in bonds.dropna(subset=["vs_market"]).iterrows():
            if b["days"] < 20 or abs(b["vs_market"]) < margin or b.get("note"):
                continue
            act = "BUY" if b["vs_market"] > 0 else "SELL"
            signals.append(E.Signal(b["symbol"], b["category"], act, round(b["vs_market"], 1), b["price"],
                                    [f"بازده تا سررسید {b['ytm']:.1f}٪ ({int(b['days'])} روز)",
                                     f"{'ارزان‌تر' if act == 'BUY' else 'گران‌تر'} از میانه بازار ({bench:.1f}٪) به اندازه {b['vs_market']:+.1f}٪"]
                                    + ([b['note']] if b.get("note") else []), extra={"ytm": round(b["ytm"], 2)}))

    for osym in wl.get("options", []):
        info = safe(T.resolve, osym)
        opt = T.parse_option_name(info["name"]) if info else None
        if not opt:
            continue
        prem_df = safe(T.history, info["ins_code"], 5, default=pd.DataFrame())
        base = cache_hist.get(opt["underlying"])
        if base is None:
            binfo = safe(T.resolve, opt["underlying"])
            base = safe(T.history, binfo["ins_code"], 120, default=pd.DataFrame()) if binfo else pd.DataFrame()
        if prem_df.empty or base is None or base.empty:
            continue
        signals.append(E.option_signal(osym, opt, float(prem_df["last"].iloc[-1]), base,
                                       jalali_to_gregorian(opt["expiry_jalali"]), today, cfg["_bench"]))
    signals += E.gold_signals(local, sc["coin_bubble_sell"], sc["coin_bubble_buy"])
    nb = {"overall": news_score, "by_tag": {"سیاست/تحریم": -(nlp.get("impact") or {}).get("دلار", 0)}}
    narrative = E.macro_narrative(glob, local, nb)

    log.info("۷/۷ گزارش و داشبورد…")
    snapshot = {
        "time_tehran": datetime.now(TEHRAN).isoformat(timespec="minutes"),
        "index": overview, "breadth": breadth,
        "sector_indices_top": idx.sort_values("chg_pct", ascending=False).head(8)[["name", "chg_pct"]].to_dict("records") if not idx.empty and "chg_pct" in idx else [],
        "bond_market_median_ytm": bench,
        "local_prices": local, "global": glob, "macro_notes": narrative,
        "news_ai": {k: nlp.get(k) for k in ["impact", "nn", "themes", "nn_info"]},
        "top_news": [f"[{n.get('source')}] {n['title']}" for n in news[:40]],
        "codal": [f"{c['symbol']}: {c['title']}" for c in codal[:20]],
        "ime_top": ime_sum.head(10).to_dict("records") if not ime_sum.empty else [],
        "screens": {k: v.head(5)[["symbol", "chg_close"]].to_dict("records") for k, v in screens.items() if not v.empty},
        "signals": [{"symbol": s.symbol, "market": s.market, "action": s.action, "score": s.score,
                     "price": s.price, "reasons": s.reasons} for s in signals],
        "data_sources": status,
    }
    llm_text = O.run_llm(snapshot, cfg.get("llm", {}))
    page = build_dashboard(cfg, signals, mw, idx, overview, breadth, screens, bonds, local, tgju_df, glob, news, codal,
                           ime, ime_sum, other, nlp, narrative, status, llm_text)

    alerts = O.changed_signals(signals) if cfg["notify"].get("only_on_change", True) else \
        [s for s in signals if s.action != "HOLD"]
    if alerts:
        msg = "📊 سیگنال‌های جدید\n\n" + "\n\n".join(O.format_alert(s) for s in alerts[:15])
        if llm_text:
            msg += "\n\n🤖 خلاصه Claude:\n" + llm_text[:2500]
        O.send(msg, cfg["notify"])
    print("\nوضعیت منابع:")
    for k, v in status.items():
        print(f"  {k}: {v}")
    log.info("پایان: %d نماد در دیده‌بان، %d سیگنال، %d اعلان جدید — داشبورد: %s", len(mw), len(signals), len(alerts), page)
    return signals


def build_dashboard(cfg, signals, mw, idx, overview, breadth, screens, bonds, local, tgju_df, glob, news, codal,
                    ime, ime_sum, other, nlp, narrative, status, llm_text):
    t = {}
    sig_rows = [{"symbol": s.symbol, "market": s.market, "action": s.fa_action, "score": s.score, "price": s.price,
                 "stop": s.stop, "target": s.target, "reasons": " • ".join(s.reasons)} for s in
                sorted(signals, key=lambda s: ({"BUY": 0, "SELL": 1, "HOLD": 2}[s.action], -abs(s.score)))]
    t["signals"] = D.table(sig_rows, {"symbol": "نماد", "market": "بازار", "action": "سیگنال", "score": "امتیاز",
                                      "price": "قیمت", "stop": "حد ضرر", "target": "هدف", "reasons": "دلایل"})
    mwc = {"symbol": "نماد", "name": "نام", "category": "نوع", "market": "بازار", "last": "آخرین", "close": "پایانی",
           "chg_close": "تغییر٪", "value": "ارزش (ریال)", "buyer_power": "قدرت خریدار", "real_flow_bn_toman": "پول حقیقی (میلیارد ت)",
           "vol_ratio": "حجم/مبنا", "pe": "P/E"}
    t["mw"] = D.table(mw.sort_values("value", ascending=False) if not mw.empty else mw, mwc)
    for cat_key, cats in {"funds": ["صندوق طلا و کالا", "صندوق اهرمی", "صندوق درآمد ثابت", "صندوق سهامی/مختلط"],
                          "derivs": ["اختیار خرید", "اختیار فروش", "آتی"],
                          "sukuk": ["صکوک و اوراق بدهی", "گواهی سپرده کالا"]}.items():
        sub = mw[mw["category"].isin(cats)].sort_values("value", ascending=False) if not mw.empty else mw
        t[cat_key] = D.table(sub, mwc)
    t["bonds"] = D.table(bonds, {"symbol": "نماد", "category": "نوع", "price": "قیمت", "days": "روز تا سررسید",
                                 "ytm": "بازده تا سررسید٪", "vs_market": "اختلاف با میانه٪", "maturity": "سررسید", "value_bn": "ارزش (میلیارد ت)", "note": "توضیح"})
    t["idx"] = D.table(idx, {"name": "شاخص", "kind": "نوع", "value": "مقدار", "change": "تغییر", "chg_pct": "تغییر٪"})
    for i, (k, v) in enumerate(screens.items()):
        t[f"scr{i}"] = D.table(v, mwc)
    t["tgju"] = D.table(tgju_df, {"group": "گروه", "label": "عنوان", "key": "کلید", "price": "قیمت", "change_pct": "تغییر٪",
                                  "high": "بیشترین", "low": "کمترین", "time": "زمان"})
    t["glob"] = D.table([{"name": k, **v} for k, v in glob.items()], {"name": "دارایی", "last": "آخرین", "chg_1d": "۱ روز٪",
                                                                     "chg_5d": "۵ روز٪", "chg_20d": "۲۰ روز٪", "trend": "روند", "source": "منبع"})
    t["ime_sum"] = D.table(ime_sum, {"kala_short": "کالا", "trades": "تعداد عرضه", "avg_premium": "رقابت میانگین٪",
                                     "avg_price": "قیمت میانگین", "value": "ارزش"})
    t["ime"] = D.table(ime, {"date": "تاریخ", "group": "گروه", "kala": "کالا", "producer": "عرضه‌کننده", "base_price": "قیمت پایه",
                             "price": "قیمت معامله", "premium_pct": "رقابت٪", "volume": "حجم", "value": "ارزش"})
    t["other"] = D.table(other, {"category": "بازار", "item": "کالا", "price": "قیمت", "detail": "جزئیات", "source": "منبع"})
    t["news"] = D.table([{"source": n.get("source"), "title": n["title"],
                          **{f"impact_{a}": n.get("impact", [0] * 6)[i] for i, a in enumerate(NL.ASSETS)},
                          "nn_بورس": (n.get("nn") or {}).get("بورس"), "why": "، ".join(n.get("why", [])),
                          "symbols": "، ".join(n.get("symbols", [])), "link": n.get("link")} for n in news],
                        {"source": "منبع", "title": "تیتر", **{f"impact_{a}": a for a in NL.ASSETS},
                         "nn_بورس": "شبکه عصبی (بورس)", "why": "موضوع", "symbols": "نماد", "link": "link"})
    t["codal"] = D.table(codal, {"symbol": "نماد", "title": "عنوان اطلاعیه", "time": "زمان", "link": "link"})
    t["status"] = D.table([{"src": k, "st": v} for k, v in status.items()], {"src": "منبع", "st": "وضعیت"})

    ov = overview.get("bourse") or {}
    kp = [("شاخص کل", f"{ov.get('index', 0):,.0f}" if ov.get("index") else "—", ""),
          ("تغییر شاخص", f"{ov.get('index_change', 0):+,.0f}" if ov.get("index_change") is not None else "—",
           "up" if (ov.get("index_change") or 0) > 0 else "dn"),
          ("ارزش معاملات (میلیارد ت)", f"{breadth.get('total_value_bn_toman', 0):,.0f}" if breadth else "—", ""),
          ("پول حقیقی (میلیارد ت)", f"{breadth.get('real_flow_bn_toman', 0):+,.0f}" if breadth.get("real_flow_bn_toman") is not None else "—",
           "up" if breadth.get("real_flow_bn_toman", 0) > 0 else "dn"),
          ("مثبت / منفی", f"{breadth.get('positive', 0)} / {breadth.get('negative', 0)}" if breadth else "—", ""),
          ("صف خرید / فروش", f"{breadth.get('buy_queues', 0)} / {breadth.get('sell_queues', 0)}" if breadth else "—", "")]
    for k, lab in [("usd_irr", "دلار آزاد (ریال)"), ("coin_emami", "سکه امامی"), ("gold_18k", "طلای ۱۸")]:
        v = local.get(k) or {}
        kp.append((lab, f"{v['price']:,.0f}" if v.get("price") else "—", "up" if (v.get("change_pct") or 0) > 0 else "dn"))
    if bonds is not None and not bonds.empty and bonds.attrs.get("benchmark"):
        kp.append(("بازده میانه اخزا", f"{bonds.attrs['benchmark']:.1f}٪", ""))
    imp = nlp.get("impact") or {}
    news_html = "<div class='grid'>" + "".join(
        f"<div class='kpi'><span>اثر اخبار بر {a}</span><b class='{'up' if v > 0 else 'dn' if v < 0 else ''}'>{v:+.2f}</b></div>"
        for a, v in imp.items()) + "</div>"
    themes = nlp.get("themes") or {}
    news_html += "<p>" + " · ".join(f"{k} ({v})" for k, v in list(themes.items())[:12]) + "</p>"
    nn_info = nlp.get("nn_info") or {}
    news_html += f"<p class='mut'>شبکه عصبی: {json.dumps(nn_info, ensure_ascii=False)}</p>"

    tabs = [
        ("t0", "خلاصه", [("html", "اثر اخبار امروز (قواعد اقتصادی + شبکه عصبی)", news_html),
                          ("table", "سیگنال‌ها", "signals"),
                          ("text", "اثر بازارهای جهانی و ارز", "\n".join(narrative) or "—")]
         + ([("text", "تحلیل Claude", llm_text)] if llm_text else [])),
        ("t1", "فرصت‌های کل بازار", [("table", k, f"scr{i}") for i, k in enumerate(screens)]),
        ("t2", "شاخص‌ها", [("table", "شاخص‌های منتخب و صنایع", "idx", "kind")]),
        ("t3", "دیده‌بان کامل", [("table", "همه نمادهای بورس و فرابورس", "mw", "category")]),
        ("t4", "اوراق (اخزا، گام، صکوک)", [("table", "اخزا و گام — بازده تا سررسید", "bonds", "category"),
                                          ("table", "صکوک، مرابحه، اجاره و گواهی سپرده", "sukuk", "category")]),
        ("t5", "صندوق‌ها", [("table", "صندوق‌های قابل معامله", "funds", "category")]),
        ("t6", "اختیار و آتی", [("table", "قراردادهای اختیار و آتی", "derivs", "category")]),
        ("t7", "طلا، سکه، ارز", [("table", "همه قیمت‌های tgju", "tgju", "group")]),
        ("t8", "بورس کالا", [("table", "خلاصه رقابت کالاها", "ime_sum"), ("table", "معاملات بازار فیزیکی", "ime", "group")]),
        ("t9", "خودرو، آهن، مسکن", [("table", "قیمت‌ها", "other", "category")]),
        ("t10", "بازار جهانی", [("table", "کالاها، ارز و رمزارز جهانی", "glob")]),
        ("t11", "اخبار", [("table", "تیترهای اقتصادی با تحلیل اثر", "news", "source"), ("table", "اطلاعیه‌های کدال", "codal")]),
        ("t12", "وضعیت منابع", [("table", "منابع داده در این اجرا", "status")]),
    ]
    out = O.REPORTS / "latest.html"
    D.build(out, "داشبورد بازارهای مالی ایران", kp, tabs, t)
    return out


def in_market_hours(cfg) -> bool:
    mh = cfg["market_hours"]
    now = datetime.now(TEHRAN)
    hm = now.strftime("%H:%M")
    return now.weekday() in mh["days"] and mh["start"] <= hm <= mh["end"]


# ============================================================ حالت دمو (بدون اینترنت)
def install_demo():
    # دمو نباید در دیتابیس و گزارش واقعی بنویسد
    O.REPORTS = ROOT / "reports" / "demo"
    O.REPORTS.mkdir(parents=True, exist_ok=True)
    O.DB = ROOT / "data" / "demo_signals.db"
    P.DB = ROOT / "data" / "demo_prices.db"
    NL.DB = ROOT / "data" / "demo_news.db"
    NL.MODEL = ROOT / "data" / "demo_news_mlp.pkl"
    if O.DB.exists():
        O.DB.unlink()
    rng = np.random.default_rng(7)

    def fake_hist(_code, n=250):
        n = min(n, 250)
        p = 10000 * np.exp(np.cumsum(rng.normal(0.001, 0.025, n)))
        d = pd.bdate_range(end=date.today(), periods=n)
        return pd.DataFrame({"date": d, "open": p * 0.99, "high": p * 1.02, "low": p * 0.98, "close": p, "last": p,
                             "yesterday": np.r_[p[0], p[:-1]], "volume": rng.integers(1e6, 9e6, n),
                             "value": p * 5e6, "count": rng.integers(500, 3000, n)})

    def fake_ct(_code):
        n = 30
        return pd.DataFrame({"date": pd.bdate_range(end=date.today(), periods=n),
                             "buy_I_Volume": rng.integers(2e6, 8e6, n), "sell_I_Volume": rng.integers(2e6, 8e6, n),
                             "buy_CountI": rng.integers(200, 900, n), "sell_CountI": rng.integers(200, 900, n),
                             "buy_N_Volume": 0, "sell_N_Volume": 0})

    def fake_global(tickers, period="6mo"):
        return {k: fake_hist(None, 130).set_index("date") for k in tickers}

    T.resolve = lambda s: {"ins_code": "1", "symbol": T.normalize(s),
                           "name": "اختیارخ اهرم-24000-1405/09/15" if s.startswith("ض") else s}
    T.history = fake_hist
    T.client_type = fake_ct
    T.market_overview = lambda: {"bourse": {"index": 3_100_000, "index_change": 12000}}
    S.fetch_global = fake_global
    S._TGJU_CUR = {"price_dollar_rl": {"p": "1,100,000", "dp": "0.8"}, "sekee": {"p": "1,230,000,000", "dp": "1.1"},
                   "ons": {"p": "3,900", "dp": "0.4"}, "oil_brent": {"p": "68.2", "dp": "-1.2"}}
    S.fetch_tgju = lambda k: {"ounce": {"price": 3900, "change_pct": 0.4}, "usd_irr": {"price": 1_100_000, "change_pct": 0.8},
                              "coin_emami": {"price": 1_230_000_000, "change_pct": 1.1},
                              "gold_18k": {"price": 105_000_000, "change_pct": 0.5}}
    def fake_mw():
        import random
        random.seed(3)
        items = [("فولاد", "فولاد مبارکه اصفهان"), ("فملی", "ملی صنایع مس ایران"), ("خودرو", "ایران خودرو"),
                 ("شپنا", "پالایش نفت اصفهان"), ("وبملت", "بانک ملت"), ("کگل", "معدنی و صنعتی گل گهر"),
                 ("عیار", "صندوق طلای عیار مفید"), ("اهرم", "صندوق س سهامی کاریزما- اهرمی"),
                 ("اخزا204", "اسنادخزانه-م4بودجه02-041021"), ("اخزا406", "اسنادخزانه-م6بودجه04-070111"),
                 ("گام0507", "گواهی اعتبار مولد رفاه0507"), ("صکوک", "مرابحه عام دولت4-ش.خ0507"),
                 ("ضهرم5009", "اختیارخ اهرم-24000-1405/09/15")]
        rows = []
        for sym, nm in items:
            y = 900_000 if nm.startswith(("اسناد", "گواهی", "مرابحه")) else random.randint(1000, 30000)
            c = y * (1 + random.uniform(-0.05, 0.05))
            rows.append({"ins_code": sym, "symbol": sym, "name": nm, "open": y, "close": c, "last": c, "count": 100,
                         "volume": 1e6, "value": c * 1e6, "low": y * .95, "high": y * 1.05, "yesterday": y, "eps": 500,
                         "base_volume": 4e5, "flow": 1, "group": "27", "range_max": y * 1.05, "range_min": y * .95,
                         "shares": 1e9, "r_buy_n": 300, "r_buy_v": 6e5, "r_sell_n": 900, "r_sell_v": 5e5})
        df = pd.DataFrame(rows)
        return _enrich(df)

    def _enrich(df):
        orig = M._watch_old
        M._watch_old = lambda: df.drop(columns=["r_buy_n", "r_buy_v", "r_sell_n", "r_sell_v"])
        M._client_all = lambda: df[["ins_code", "r_buy_n", "r_buy_v", "r_sell_n", "r_sell_v"]].assign(l_buy_v=0, l_sell_v=0)
        out = real_mw()
        M._watch_old = orig
        return out

    real_mw = M.market_watch
    M.market_watch = fake_mw
    M.indices = lambda: pd.DataFrame([{"kind": "منتخب", "ins_code": "1", "name": "شاخص کل", "value": 3_100_000, "change": 12000, "chg_pct": 0.4},
                                      {"kind": "صنعت", "ins_code": "2", "name": "فلزات اساسی", "value": 900_000, "change": -3000, "chg_pct": -0.3}])
    N.fetch_all = lambda sites=None: ([{"title": "تشدید تحریم‌ها و جهش دلار در بازار آزاد", "source": "دمو", "link": "#"},
                                       {"title": "کاهش نرخ سود بانکی و ورود پول حقیقی به بورس؛ فولاد مبارکه صف خرید شد", "source": "دمو", "link": "#"},
                                       {"title": "افزایش قیمت خودرو در بازار", "source": "دمو", "link": "#"}], {"دمو": 3})
    N.codal_latest = lambda n=60: [{"symbol": "فولاد", "company": "فولاد", "title": "گزارش فعالیت ماهانه", "time": "1405/07/09", "link": "#"}]
    C.ime_trades = lambda days_back=5: pd.DataFrame([{"date": "1405/07/08", "kala": "میلگرد A3 ذوب آهن", "producer": "ذوب آهن", "base_price": 300000,
                                                      "price": 330000, "max_price": 335000, "volume": 2000, "value": 6.6e11, "group": "فولاد", "premium_pct": 10.0}])
    C.other_markets = lambda srcs: (pd.DataFrame([{"category": "خودرو", "item": "پژو ۲۰۷", "price": 1_150_000_000, "detail": "بازار", "source": "دمو"},
                                                  {"category": "آهن‌آلات", "item": "میلگرد ۱۲", "price": 33_000, "detail": "کیلو", "source": "دمو"}]), [])
    S.fetch_nobitex = lambda: {"usdt_irr": {"price": 1_080_000, "change_pct": 0.6}}
    T.discover_akhza = lambda: [{"symbol": "اخزا-دمو", "ins_code": "1", "maturity": "1406/03/20", "face": 1_000_000}]
    S.fetch_news = lambda c: [{"title": "رشد شاخص کل بورس با ورود پول حقیقی", "link": "#", "score": 2, "tags": ["بورس"]},
                              {"title": "افزایش تنش و نگرانی از تحریم‌های جدید", "link": "#", "score": -2, "tags": ["سیاست/تحریم"]}]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    a = ap.parse_args()
    NET.install()
    cfg = yaml.safe_load(Path(a.config).read_text(encoding="utf-8"))
    if a.demo:
        install_demo()
        cfg["watchlist"]["options"] = ["ضهرم5009"]
        run_cycle(cfg); return
    if a.loop:
        while True:
            if in_market_hours(cfg) or cfg["market_hours"].get("run_outside_hours"):
                safe(run_cycle, cfg, what="چرخه")
            time.sleep(cfg["interval_minutes"] * 60 if in_market_hours(cfg) else max(60, cfg["interval_minutes"] * 4) * 60)
    else:
        run_cycle(cfg)


if __name__ == "__main__":
    main()
