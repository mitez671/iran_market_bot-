"""تست سریع اتصال به منابع داده. خروجی در reports/source_check.txt (بعد از هر تست ذخیره می‌شود)."""
from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "reports" / "source_check.txt"
OUT.parent.mkdir(exist_ok=True)
lines = [f"source check {datetime.now():%Y-%m-%d %H:%M:%S}", f"python {sys.version.split()[0]}"]


def save():
    OUT.write_text("\n".join(lines), encoding="utf-8")


def check(name, fn):
    print(f"  ... {name}", flush=True)
    t0 = time.time()
    try:
        res = str(fn())
        lines.append(f"[OK]   {name} ({time.time()-t0:.0f}s): {res[:600]}")
        print(f"  OK   {name}", flush=True)
    except Exception as e:  # noqa: BLE001
        lines.append(f"[FAIL] {name} ({time.time()-t0:.0f}s): {type(e).__name__}: {str(e)[:300]}")
        print(f"  FAIL {name}: {type(e).__name__}", flush=True)
    save()


from sources import others as S  # noqa: E402
from sources import tsetmc as T  # noqa: E402
from sources import market as M  # noqa: E402
from sources import news as N  # noqa: E402
from sources import commodity as C  # noqa: E402
import yaml  # noqa: E402

cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
T.RETRIES = 1
check("TSETMC شاخص کل", lambda: T.market_overview())
check("دیده‌بان کامل", lambda: M.market_watch()["category"].value_counts().to_dict())
check("شاخص صنایع", lambda: len(M.indices()))
check("tgju", lambda: {k: v["price"] for k, v in S.fetch_tgju({"usd": "price_dollar_rl", "coin": "sekee", "ons": "ons"}).items()})
check("بورس کالا", lambda: len(C.ime_trades()))
check("کدال", lambda: [c["title"] for c in N.codal_latest(3)])
for site in cfg["news"]["sites"]:
    check("خبر " + site["name"], lambda s=site: [x["title"] for x in N.fetch_site(s)][:3])
for src in cfg.get("other_markets", []):
    check(f"{src['category']} {src['name']}", lambda s=src: C.scrape_tables(s).head(3).to_dict("records"))
lines.append("done")
save()
print("source check done", flush=True)
