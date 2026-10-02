"""تاریخچه محلی قیمت‌ها (برای محاسبه تغییر چندروزه وقتی فقط قیمت لحظه‌ای داریم، مثل tgju)."""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "prices.db"


def _con():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.execute("CREATE TABLE IF NOT EXISTS px(d TEXT, name TEXT, price REAL, PRIMARY KEY(d, name))")
    return c


def save(prices: dict[str, float]) -> None:
    c, d = _con(), date.today().isoformat()
    for k, v in prices.items():
        if v:
            c.execute("INSERT OR REPLACE INTO px VALUES(?,?,?)", (d, k, float(v)))
    c.commit(); c.close()


def change_pct(name: str, price: float, days: int) -> float | None:
    """تغییر درصدی نسبت به نزدیک‌ترین قیمت ذخیره‌شده با حداقل `days` روز فاصله."""
    c = _con()
    row = c.execute("SELECT price FROM px WHERE name=? AND d<=? ORDER BY d DESC LIMIT 1",
                    (name, (date.today() - timedelta(days=days)).isoformat())).fetchone()
    c.close()
    return (price / row[0] - 1) * 100 if row and row[0] else None


def next_change(name: str, d: str) -> float | None:
    """تغییر درصدی از روز d تا اولین روز ثبت‌شده بعد از آن (برای برچسب‌زدن اخبار با واکنش بازار)."""
    c = _con()
    a = c.execute("SELECT price FROM px WHERE name=? AND d<=? ORDER BY d DESC LIMIT 1", (name, d)).fetchone()
    b = c.execute("SELECT price FROM px WHERE name=? AND d>? ORDER BY d ASC LIMIT 1", (name, d)).fetchone()
    c.close()
    return (b[0] / a[0] - 1) * 100 if a and b and a[0] else None
