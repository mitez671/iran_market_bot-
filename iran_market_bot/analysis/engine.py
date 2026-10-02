"""اندیکاتورها و موتور سیگنال: سهام/صندوق، اوراق بدون کوپن، اختیار معامله، سکه و طلا، اثر بازارهای جهانی."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

TRADING_DAYS = 240  # تقریب روزهای معاملاتی سال در بورس تهران


@dataclass
class Signal:
    symbol: str
    market: str                 # سهام / صندوق / اوراق / اختیار / طلا و سکه
    action: str                 # BUY / SELL / HOLD
    score: float
    price: float | None = None
    reasons: list[str] = field(default_factory=list)
    stop: float | None = None
    target: float | None = None
    extra: dict = field(default_factory=dict)

    @property
    def fa_action(self) -> str:
        return {"BUY": "🟢 خرید", "SELL": "🔴 فروش", "HOLD": "⚪ نگهداری/صبر"}[self.action]


def _decide(score: float, min_score: float) -> str:
    return "BUY" if score >= min_score else "SELL" if score <= -min_score else "HOLD"


# ============================================================ اندیکاتورها
def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def macd(s: pd.Series):
    m = s.ewm(span=12, adjust=False).mean() - s.ewm(span=26, adjust=False).mean()
    return m, m.ewm(span=9, adjust=False).mean()


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def pct(s: pd.Series, n: int) -> float | None:
    if len(s) <= n or s.iloc[-n - 1] == 0:
        return None
    return float(s.iloc[-1] / s.iloc[-n - 1] - 1) * 100


# ============================================================ بازار جهانی و اثر بین‌بازاری
def global_summary(gl: dict[str, pd.DataFrame]) -> dict:
    out = {}
    for name, df in gl.items():
        c = df["close"]
        if len(c) < 25:
            continue
        ma50 = c.rolling(50).mean().iloc[-1] if len(c) >= 50 else np.nan
        out[name] = {
            "last": float(c.iloc[-1]),
            "chg_1d": pct(c, 1), "chg_5d": pct(c, 5), "chg_20d": pct(c, 20),
            "trend": "صعودی" if not np.isnan(ma50) and c.iloc[-1] > ma50 else "نزولی" if not np.isnan(ma50) else "نامشخص",
            "rsi": float(rsi(c).iloc[-1]),
        }
    return out


def intermarket_score(symbol: str, sens: dict, glob: dict, usd_chg_pct: float | None) -> tuple[float, list[str]]:
    """امتیاز اثر عوامل جهانی/ارزی بر یک نماد ایرانی بر اساس جدول حساسیت."""
    weights = sens.get(symbol, {})
    score, reasons = 0.0, []
    for factor, w in weights.items():
        if factor == "usd_irr":
            ch = usd_chg_pct
            label = "دلار آزاد"
        else:
            g = glob.get(factor) or {}
            ch = g.get("chg_5d") if g.get("chg_5d") is not None else g.get("chg_1d")
            label = factor
        if ch is None:
            continue
        # هر ۳٪ تغییر هفتگی ≈ ۱ امتیاز (حداکثر ±۲)
        contrib = max(-2.0, min(2.0, w * ch / 3))
        if abs(contrib) >= 0.3:
            score += contrib
            reasons.append(f"{label} {ch:+.1f}٪ → اثر {'مثبت' if contrib > 0 else 'منفی'} ({contrib:+.1f})")
    return score, reasons


def macro_narrative(glob: dict, local: dict, nb: dict) -> list[str]:
    """جملات تحلیلی ساده درباره اثر بازار جهانی بر ایران."""
    lines = []
    def g(k, f="chg_5d"):
        d = glob.get(k) or {}
        return d.get(f) if d.get(f) is not None else d.get("chg_1d")
    if g("brent") is not None:
        lines.append(f"برنت در ۵ روز {g('brent'):+.1f}٪: " + (
            "مثبت برای پالایشی‌ها و پتروشیمی‌ها (شپنا، شبندر، پتروشیمی‌ها) و درآمد ارزی دولت."
            if g("brent") > 0 else "فشار بر پالایشی/پتروشیمی و احتمال کسری بودجه → ریسک تورم و رشد دلار در میان‌مدت."))
    if g("gold_ounce") is not None:
        lines.append(f"انس طلا در ۵ روز {g('gold_ounce'):+.1f}٪: مستقیماً روی سکه، طلای ۱۸ و صندوق‌های طلا اثر دارد.")
    if g("copper") is not None:
        lines.append(f"مس جهانی {g('copper'):+.1f}٪: اثر مستقیم بر فملی و گروه مس.")
    if g("dxy") is not None:
        lines.append(f"شاخص دلار (DXY) {g('dxy'):+.1f}٪: " + ("دلار قوی جهانی معمولاً به ضرر کامودیتی‌هاست."
                                                       if g("dxy") > 0 else "دلار ضعیف جهانی معمولاً به نفع کامودیتی‌ها و طلاست."))
    if g("bitcoin") is not None:
        lines.append(f"بیت‌کوین {g('bitcoin'):+.1f}٪ (۵ روز): شاخص ریسک‌پذیری جهانی و رقیب سرمایه‌گذاری برای بخشی از پول خرد داخلی.")
    usd = (local.get("usd_irr") or {})
    if usd.get("change_pct") is not None:
        lines.append(f"دلار آزاد امروز {usd['change_pct']:+.2f}٪: رشد دلار به نفع صادرات‌محورها (فلزی، پتروشیمی) و طلا؛ به ضرر واردات‌محورها.")
    if nb.get("by_tag", {}).get("سیاست/تحریم") is not None:
        v = nb["by_tag"]["سیاست/تحریم"]
        lines.append(f"فضای خبری سیاسی/تحریم: {'مثبت' if v > 0 else 'منفی' if v < 0 else 'خنثی'} ({v:+.2f}) — "
                     "اخبار منفی معمولاً دلار و طلا را بالا و شاخص را (به‌جز دلاری‌ها) پایین می‌برد.")
    return lines


# ============================================================ سهام و صندوق
def stock_signal(sym: str, market: str, df: pd.DataFrame, ct: pd.DataFrame | None,
                 inter: tuple[float, list[str]], news_overall: float, min_score: float) -> Signal:
    c = df["close"].astype(float)
    if len(c) < 35:
        return Signal(sym, market, "HOLD", 0, float(c.iloc[-1]) if len(c) else None, ["داده کافی نیست"])
    score, why = 0.0, []
    r = rsi(c).iloc[-1]
    if r < 30:
        score += 1; why.append(f"RSI={r:.0f} اشباع فروش")
    elif r > 70:
        score -= 1; why.append(f"RSI={r:.0f} اشباع خرید")
    m, sg = macd(c)
    if m.iloc[-1] > sg.iloc[-1] and m.iloc[-3] <= sg.iloc[-3]:
        score += 1; why.append("کراس صعودی MACD")
    elif m.iloc[-1] < sg.iloc[-1] and m.iloc[-3] >= sg.iloc[-3]:
        score -= 1; why.append("کراس نزولی MACD")
    ma20, ma50 = c.rolling(20).mean().iloc[-1], c.rolling(min(50, len(c))).mean().iloc[-1]
    if c.iloc[-1] > ma20 > ma50:
        score += 1; why.append("روند صعودی (قیمت > MA20 > MA50)")
    elif c.iloc[-1] < ma20 < ma50:
        score -= 1; why.append("روند نزولی (قیمت < MA20 < MA50)")
    std = c.rolling(20).std().iloc[-1]
    if c.iloc[-1] < ma20 - 2 * std:
        score += 0.5; why.append("زیر باند پایین بولینگر")
    elif c.iloc[-1] > ma20 + 2 * std:
        score -= 0.5; why.append("بالای باند بالای بولینگر")
    vol_ratio = df["volume"].iloc[-1] / max(df["volume"].iloc[-21:-1].mean(), 1)
    day_chg = c.iloc[-1] / c.iloc[-2] - 1
    if vol_ratio > 2:
        s = 1 if day_chg > 0 else -1
        score += s; why.append(f"حجم {vol_ratio:.1f} برابر میانگین ماه با {'رشد' if s > 0 else 'افت'} قیمت")

    # ---- رفتار حقیقی/حقوقی (مخصوص بازار ایران)
    if ct is not None and len(ct) >= 5:
        t = ct.iloc[-1]
        bpc = t["buy_I_Volume"] / t["buy_CountI"] if t["buy_CountI"] else 0
        spc = t["sell_I_Volume"] / t["sell_CountI"] if t["sell_CountI"] else 0
        if bpc and spc:
            power = bpc / spc
            if power >= 1.5:
                score += 2; why.append(f"قدرت خریدار حقیقی {power:.2f} (سرانه خرید قوی)")
            elif power <= 0.67:
                score -= 2; why.append(f"قدرت فروشنده حقیقی بالا (نسبت {power:.2f})")
        last5 = ct.iloc[-5:]
        price = float(c.iloc[-1])
        flow = ((last5["buy_I_Volume"] - last5["sell_I_Volume"]) * price).sum()
        if abs(flow) > 0:
            s = 1 if flow > 0 else -1
            score += s; why.append(f"{'ورود' if s > 0 else 'خروج'} پول حقیقی ۵ روز ≈ {abs(flow)/1e10:,.0f} میلیارد تومان")

    score += inter[0]; why += inter[1]
    if abs(news_overall) >= 0.5:
        score += 0.5 * np.sign(news_overall)
        why.append(f"فضای کلی اخبار {'مثبت' if news_overall > 0 else 'منفی'}")

    a = atr(df).iloc[-1]
    price = float(c.iloc[-1])
    act = _decide(score, min_score)
    return Signal(sym, market, act, round(score, 1), price, why,
                  stop=round(price - 2 * a) if act == "BUY" and not math.isnan(a) else None,
                  target=round(price + 3 * a) if act == "BUY" and not math.isnan(a) else None,
                  extra={"rsi": round(float(r), 1), "chg_1d": round(day_chg * 100, 2), "vol_ratio": round(vol_ratio, 2)})


# ============================================================ اوراق بدون کوپن (اخزا، گام، ...)
def zero_coupon_signal(sym: str, price: float, face: float, maturity_g: date, today: date,
                       benchmark: float, margin: float) -> Signal:
    days = (maturity_g - today).days
    if days <= 0 or not price:
        return Signal(sym, "اوراق", "HOLD", 0, price, ["سررسید گذشته یا قیمت نامعتبر"])
    if not (0.3 * face <= price <= 1.05 * face):
        return Signal(sym, "اوراق", "HOLD", 0, price, [f"قیمت {price:,.0f} با اسمی {face:,.0f} نمی‌خواند — داده یا تنظیمات را چک کن"])
    ytm = (face / price) ** (365 / days) - 1
    simple = (face / price - 1) * 365 / days
    diff = ytm - benchmark
    act = "BUY" if diff >= margin else "SELL" if diff <= -margin else "HOLD"
    why = [f"YTM موثر {ytm*100:.1f}٪ (ساده {simple*100:.1f}٪) — {days} روز تا سررسید",
           f"بنچمارک {benchmark*100:.0f}٪ → اختلاف {diff*100:+.1f}٪"]
    return Signal(sym, "اوراق", act, round(diff * 100, 1), price, why, extra={"ytm": round(ytm * 100, 2), "days": days})


# ============================================================ اختیار معامله (بلک-شولز با نوسان تاریخی)
def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def black_scholes(S, K, T, r, sigma, kind):
    if T <= 0 or sigma <= 0:
        return max(0.0, S - K) if kind == "call" else max(0.0, K - S)
    d1 = (math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if kind == "call":
        return S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2)
    return K * math.exp(-r * T) * _ncdf(-d2) - S * _ncdf(-d1)


def option_signal(sym: str, opt: dict, premium: float, under_df: pd.DataFrame, expiry_g: date, today: date,
                  r: float) -> Signal:
    S = float(under_df["close"].iloc[-1])
    lr = np.log(under_df["close"] / under_df["close"].shift()).dropna().iloc[-60:]
    sigma = float(lr.std() * math.sqrt(TRADING_DAYS))
    T = max((expiry_g - today).days, 0) / 365
    fair = black_scholes(S, opt["strike"], T, math.log(1 + r), sigma, opt["kind"])
    intrinsic = max(0.0, S - opt["strike"]) if opt["kind"] == "call" else max(0.0, opt["strike"] - S)
    be = opt["strike"] + premium if opt["kind"] == "call" else opt["strike"] - premium
    ratio = premium / fair if fair > 0 else np.inf
    why = [f"پایه {opt['underlying']}={S:,.0f}، اعمال {opt['strike']:,.0f}، {int(T*365)} روز مانده",
           f"ارزش منصفانه (BS، نوسان تاریخی {sigma*100:.0f}٪) ≈ {fair:,.0f} | قیمت {premium:,.0f}",
           f"سربه‌سر {be:,.0f} ({(be/S-1)*100:+.1f}٪ از قیمت پایه) | ارزش ذاتی {intrinsic:,.0f}"]
    if premium < intrinsic * 0.98:
        why.append("⚠️ زیر ارزش ذاتی — فرصت آربیتراژ احتمالی")
    act = "BUY" if ratio < 0.8 else "SELL" if ratio > 1.25 else "HOLD"
    if act == "SELL":
        why.append("گران نسبت به مدل → مناسب فروش/پوشش (کاورد کال) نه خرید")
    return Signal(sym, "اختیار", act, round(max(-10.0, min(10.0, (1 - ratio) * 10)), 1) if np.isfinite(ratio) else -10, premium, why,
                  extra={"fair": round(fair), "sigma": round(sigma * 100, 1), "lev": round(S / premium, 1) if premium else None})


# ============================================================ سکه و طلا (حباب)
GOLD_PURE_GRAMS = {"coin_emami": 8.13552 * 0.9, "coin_half": 4.0678 * 0.9, "coin_quarter": 2.0339 * 0.9}


def gold_signals(local: dict, sell_th: float, buy_th: float) -> list[Signal]:
    out = []
    ons, usd = (local.get("ounce") or {}).get("price"), (local.get("usd_irr") or {}).get("price")
    if not ons or not usd:
        return out
    gram_pure = ons / 31.1035 * usd
    g18 = (local.get("gold_18k") or {}).get("price")
    if g18:
        intr = gram_pure * 0.75
        bub = (g18 / intr - 1) * 100
        out.append(Signal("طلای ۱۸ عیار (گرم)", "طلا و سکه", "SELL" if bub > 8 else "BUY" if bub < -1 else "HOLD",
                          round(-bub, 1), g18, [f"ارزش ذاتی ≈ {intr:,.0f} ریال | حباب {bub:+.1f}٪"],
                          extra={"bubble": round(bub, 1)}))
    names = {"coin_emami": "سکه امامی", "coin_half": "نیم سکه", "coin_quarter": "ربع سکه"}
    for k, grams in GOLD_PURE_GRAMS.items():
        p = (local.get(k) or {}).get("price")
        if not p:
            continue
        intr = gram_pure * grams
        bub = (p / intr - 1) * 100
        act = "SELL" if bub > sell_th else "BUY" if bub < buy_th else "HOLD"
        out.append(Signal(names[k], "طلا و سکه", act, round(-bub, 1), p,
                          [f"ارزش ذاتی ≈ {intr:,.0f} ریال (انس {ons:,.0f}$ × دلار {usd:,.0f})", f"حباب {bub:+.1f}٪"],
                          extra={"bubble": round(bub, 1)}))
    return out
