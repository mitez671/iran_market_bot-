"""تحلیل با Claude، ارسال اعلان (تلگرام/بله)، گزارش HTML و ذخیره تاریخچه سیگنال."""
from __future__ import annotations

import html
import json
import logging
import os
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
DB = ROOT / "data" / "signals.db"

SYSTEM_PROMPT = (
    "تو تحلیلگر ارشد بازار سرمایه ایران هستی (بورس، فرابورس، صندوق‌ها، اوراق خزانه و گام، اختیار معامله، "
    "سکه و طلا، ارز) و اثر بازارهای جهانی (نفت، طلا، فلزات، دلار، رمزارزها) و اخبار سیاسی/اقتصادی ایران را می‌شناسی. "
    "داده‌های زیر خروجی یک سامانه خودکار است. کارهای تو: "
    "۱) سیگنال‌های خرید/فروش را نقد کن و آن‌هایی که با اخبار و شرایط کلان تناقض دارند را مشخص کن؛ "
    "۲) بهترین ۳ فرصت خرید و مهم‌ترین ریسک‌ها را با دلیل، حد ضرر و افق زمانی بگو؛ "
    "۳) سناریوی کوتاه‌مدت دلار، سکه و شاخص کل را بنویس؛ "
    "۴) اگر داده‌ای مشکوک یا ناقص است بگو. پاسخ فارسی، فشرده و کاربردی. "
    "این تحلیل توصیه قطعی سرمایه‌گذاری نیست؛ احتمالات و ریسک را صریح بگو."
)


def build_prompt(snapshot: dict) -> str:
    return SYSTEM_PROMPT + "\n\n```json\n" + json.dumps(snapshot, ensure_ascii=False, indent=1, default=str) + "\n```"


def run_llm(snapshot: dict, cfg: dict) -> str | None:
    mode = cfg.get("mode", "manual")
    prompt = build_prompt(snapshot)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    if mode == "manual":
        p = REPORTS / f"claude_prompt_{stamp}.md"
        p.write_text(prompt, encoding="utf-8")
        log.info("پرامپت آماده شد: %s (در اپ Claude آپلود یا پیست کن)", p)
        return None
    if mode == "api":
        try:
            import anthropic
        except ImportError:
            log.error("pip install anthropic"); return None
        if not os.environ.get("ANTHROPIC_API_KEY"):
            log.error("متغیر ANTHROPIC_API_KEY تنظیم نشده"); return None
        client = anthropic.Anthropic()
        kw = dict(model=cfg.get("model", "claude-sonnet-5-5"), max_tokens=cfg.get("max_tokens", 2500),
                  system=SYSTEM_PROMPT,
                  messages=[{"role": "user", "content": prompt.replace(SYSTEM_PROMPT, "داده‌های امروز:")}])
        if cfg.get("use_web_search"):
            kw["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]
        try:
            msg = client.messages.create(**kw)
            text = "\n".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        except Exception as e:  # noqa: BLE001
            log.error("Claude API error: %s", e); return None
    elif mode == "claude_code":
        if not shutil.which("claude"):
            log.error("Claude Code نصب نیست (npm i -g @anthropic-ai/claude-code)"); return None
        try:
            res = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True, timeout=600)
            text = res.stdout.strip() or res.stderr.strip()
        except Exception as e:  # noqa: BLE001
            log.error("claude -p failed: %s", e); return None
    else:
        log.error("llm.mode نامعتبر: %s", mode); return None
    (REPORTS / f"claude_analysis_{stamp}.md").write_text(text, encoding="utf-8")
    return text


# ============================================================ تاریخچه و اعلان
def _db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("CREATE TABLE IF NOT EXISTS sig(ts TEXT, symbol TEXT, market TEXT, action TEXT, score REAL, price REAL, reasons TEXT)")
    return con


def changed_signals(signals) -> list:
    """سیگنال‌های خرید/فروشی که با آخرین وضعیت ثبت‌شده آن نماد فرق دارند."""
    con, out = _db(), []
    now = datetime.now().isoformat(timespec="seconds")
    for s in signals:
        row = con.execute("SELECT action FROM sig WHERE symbol=? ORDER BY ts DESC LIMIT 1", (s.symbol,)).fetchone()
        if s.action != "HOLD" and (row is None or row[0] != s.action):
            out.append(s)
        con.execute("INSERT INTO sig VALUES(?,?,?,?,?,?,?)",
                    (now, s.symbol, s.market, s.action, s.score, s.price, " | ".join(s.reasons)))
    con.commit(); con.close()
    return out


def format_alert(s) -> str:
    t = f"{s.fa_action} | {s.symbol} ({s.market})\nامتیاز: {s.score}"
    if s.price:
        t += f" | قیمت: {s.price:,.0f}"
    if s.stop:
        t += f"\nحد ضرر: {s.stop:,.0f} | هدف: {s.target:,.0f}"
    return t + "\n• " + "\n• ".join(s.reasons[:6])


def send(text: str, ncfg: dict) -> None:
    for name, base in [("telegram", "https://api.telegram.org"), ("bale", "https://tapi.bale.ai")]:
        c = ncfg.get(name, {})
        if not c.get("enabled"):
            continue
        try:
            for chunk in [text[i:i + 3800] for i in range(0, len(text), 3800)]:
                requests.post(f"{base}/bot{c['bot_token']}/sendMessage",
                              json={"chat_id": c["chat_id"], "text": chunk}, timeout=20).raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.warning("ارسال %s ناموفق: %s", name, e)


# ============================================================ گزارش HTML
def _fmt(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.2f}" if abs(v) < 1000 else f"{v:,.0f}"
    return html.escape(str(v))


def write_html(signals, glob, local, overview, narrative, news, llm_text) -> Path:
    order = {"BUY": 0, "SELL": 1, "HOLD": 2}
    rows = "".join(
        f"<tr class='{s.action.lower()}'><td>{html.escape(s.symbol)}</td><td>{s.market}</td><td>{s.fa_action}</td>"
        f"<td>{s.score}</td><td>{_fmt(s.price)}</td><td>{_fmt(s.stop)}</td><td>{_fmt(s.target)}</td>"
        f"<td class='r'>{'<br>'.join(html.escape(x) for x in s.reasons)}</td></tr>"
        for s in sorted(signals, key=lambda s: (order[s.action], -abs(s.score))))
    g_rows = "".join(f"<tr><td>{k}</td><td>{_fmt(v['last'])}</td><td>{_fmt(v['chg_1d'])}</td><td>{_fmt(v['chg_5d'])}</td>"
                     f"<td>{_fmt(v['chg_20d'])}</td><td>{v['trend']}</td></tr>" for k, v in glob.items())
    l_rows = "".join(f"<tr><td>{k}</td><td>{_fmt(v['price'])}</td><td>{_fmt(v['change_pct'])}</td></tr>" for k, v in local.items())
    o_rows = "".join(f"<tr><td>{k}</td><td>{_fmt(v.get('index'))}</td><td>{_fmt(v.get('index_change'))}</td></tr>"
                     for k, v in overview.items())
    n_rows = "".join(f"<li><a href='{html.escape(n['link'] or '#')}'>{html.escape(n['title'])}</a> "
                     f"<small>[{n['score']:+d}] {'، '.join(n['tags'])}</small></li>" for n in news[:40])
    css = """body{font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl;margin:0;padding:12px;background:#f6f7f9;color:#111}
    h2{margin:18px 0 6px}.box{overflow-x:auto;background:#fff;border-radius:10px;padding:8px;box-shadow:0 1px 3px #0001}
    table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap}
    td.r{white-space:normal;min-width:260px;font-size:12px;color:#444}tr.buy{background:#e9f9ee}tr.sell{background:#fdecec}
    pre{white-space:pre-wrap;font-family:inherit}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}.box{background:#1c1c1c}
    td.r{color:#bbb}tr.buy{background:#123222}tr.sell{background:#3a1616}td,th{border-color:#333}}"""
    body = f"""<!doctype html><html lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>پایش بازار {datetime.now():%Y-%m-%d %H:%M}</title><style>{css}</style></head><body>
<h1>پایش بازار — {datetime.now():%Y-%m-%d %H:%M}</h1>
<h2>سیگنال‌ها</h2><div class="box"><table><tr><th>نماد</th><th>بازار</th><th>سیگنال</th><th>امتیاز</th><th>قیمت</th><th>حد ضرر</th><th>هدف</th><th>دلایل</th></tr>{rows}</table></div>
<h2>اثر بازارهای جهانی بر ایران</h2><div class="box"><ul>{''.join(f'<li>{html.escape(x)}</li>' for x in narrative)}</ul></div>
<h2>شاخص‌ها</h2><div class="box"><table><tr><th>بازار</th><th>شاخص</th><th>تغییر</th></tr>{o_rows}</table></div>
<h2>طلا، سکه، ارز (داخلی)</h2><div class="box"><table><tr><th>دارایی</th><th>قیمت (ریال)</th><th>تغییر٪</th></tr>{l_rows}</table></div>
<h2>بازارهای جهانی</h2><div class="box"><table><tr><th>دارایی</th><th>آخرین</th><th>۱روز٪</th><th>۵روز٪</th><th>۲۰روز٪</th><th>روند</th></tr>{g_rows}</table></div>
{'<h2>تحلیل Claude</h2><div class="box"><pre>' + html.escape(llm_text) + '</pre></div>' if llm_text else ''}
<h2>اخبار</h2><div class="box"><ul>{n_rows}</ul></div>
<p><small>خروجی خودکار و آموزشی است؛ توصیه سرمایه‌گذاری نیست.</small></p></body></html>"""
    p = REPORTS / "latest.html"
    p.write_text(body, encoding="utf-8")
    (REPORTS / f"report_{datetime.now():%Y%m%d_%H%M}.html").write_text(body, encoding="utf-8")
    return p
