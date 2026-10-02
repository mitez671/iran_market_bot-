"""تحلیل هوشمند اخبار.

سه لایه:
1) قواعد اقتصادی (قابل توضیح): هر خبر روی ۶ بازار اثر جهت‌دار دارد (بورس، دلار، طلا/سکه، نفت، مسکن، خودرو).
   مثلاً «تحریم» → دلار↑ طلا↑ بورس↓ ؛ «کاهش نرخ بهره» → بورس↑ مسکن↑.
2) شبکه عصبی خودآموز (MLP روی n-gram حروف): هر خبر با واکنش واقعی بازار در روز معاملاتی بعد برچسب می‌خورد
   (تغییر شاخص کل و دلار). هرچه سامانه بیشتر اجرا شود، مدل بیشتر یاد می‌گیرد. تا وقتی داده واقعی کم است،
   با برچسب‌های لایه ۱ گرم می‌شود و اعتمادش را صریح گزارش می‌کند.
3) (اختیاری) مدل زبانی فارسی ParsBERT برای تشخیص لحن مثبت/منفی — اگر transformers نصب و فعال باشد.
+ تشخیص نماد: خبری که نام یا نماد یک شرکت را دارد به آن نماد وصل می‌شود.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "news.db"
MODEL = ROOT / "data" / "news_mlp.pkl"
ASSETS = ["بورس", "دلار", "طلا و سکه", "نفت", "مسکن", "خودرو"]

# (کلمات, اثر روی [بورس، دلار، طلا، نفت، مسکن، خودرو], برچسب)
RULES = [
    (["لغو تحریم", "رفع تحریم", "توافق هسته", "احیای برجام", "توافق ایران و آمریکا", "کاهش تنش"], [2, -2, -2, 0, -1, -1], "گشایش سیاسی"),
    (["تحریم جدید", "تشدید تحریم", "اسنپ بک", "مکانیسم ماشه", "شکست مذاکر", "قطعنامه"], [-2, 2, 2, 0, 1, 1], "ریسک تحریم"),
    (["حمله", "جنگ", "درگیری نظامی", "تنش نظامی", "پهپاد", "موشک"], [-2, 2, 2, 1, 0, 1], "ریسک ژئوپلیتیک"),
    (["کاهش نرخ بهره", "کاهش سود بانکی", "تزریق نقدینگی", "کاهش نرخ سود"], [2, 1, 1, 0, 1, 1], "سیاست پولی انبساطی"),
    (["افزایش نرخ بهره", "افزایش سود بانکی", "افزایش نرخ سود", "انقباض", "سقف رشد ترازنامه"], [-2, -1, -1, 0, -1, -1], "سیاست پولی انقباضی"),
    (["حراج اوراق", "انتشار اوراق", "فروش اوراق"], [-1, 0, 0, 0, 0, 0], "رقابت اوراق با سهام"),
    (["تورم", "رشد نقدینگی", "کسری بودجه", "چاپ پول"], [1, 1, 1, 0, 1, 1], "فشار تورمی"),
    (["افزایش قیمت نفت", "رشد قیمت نفت", "صعود نفت", "افزایش صادرات نفت"], [1, -1, 0, 2, 0, 0], "نفت قوی‌تر"),
    (["کاهش قیمت نفت", "سقوط نفت", "افت قیمت نفت", "کاهش صادرات نفت"], [-1, 1, 0, -2, 0, 0], "نفت ضعیف‌تر"),
    (["افزایش قیمت دلار", "رشد دلار", "دلار گران", "جهش دلار", "دلار ۹", "دلار رکورد"], [1, 2, 2, 0, 1, 1], "رشد ارز"),
    (["کاهش قیمت دلار", "افت دلار", "دلار ارزان", "ریزش دلار"], [-1, -2, -2, 0, 0, -1], "افت ارز"),
    (["قیمت‌گذاری دستوری", "قیمت گذاری دستوری", "سقف قیمت", "عوارض صادرات", "ممنوعیت صادرات"], [-2, 0, 0, 0, 0, 0], "دخالت قیمتی"),
    (["افزایش قیمت خودرو", "گرانی خودرو", "افزایش قیمت کارخانه"], [0, 0, 0, 0, 0, 2], "خودرو گران"),
    (["کاهش قیمت خودرو", "واردات خودرو", "ارزانی خودرو"], [0, 0, 0, 0, 0, -2], "خودرو ارزان"),
    (["افزایش اجاره", "گرانی مسکن", "رشد قیمت مسکن"], [0, 0, 0, 0, 2, 0], "مسکن گران"),
    (["رکود مسکن", "کاهش معاملات مسکن", "مالیات بر خانه خالی"], [0, 0, 0, 0, -2, 0], "رکود مسکن"),
    (["ورود پول حقیقی", "رشد شاخص", "سبزپوشی", "صف خرید", "رکورد شاخص"], [2, 0, 0, 0, 0, 0], "جو مثبت بورس"),
    (["خروج پول حقیقی", "ریزش شاخص", "افت شاخص", "صف فروش", "قرمزپوش"], [-2, 0, 0, 0, 0, 0], "جو منفی بورس"),
    (["صندوق تثبیت", "حمایت از بازار", "حمایت از بورس"], [1, 0, 0, 0, 0, 0], "حمایت دولتی"),
    (["افزایش سرمایه", "سود سهام", "تقسیم سود", "افزایش فروش", "رشد سود"], [1, 0, 0, 0, 0, 0], "خبر شرکتی مثبت"),
    (["زیان", "کاهش سود", "کاهش فروش", "توقف نماد"], [-1, 0, 0, 0, 0, 0], "خبر شرکتی منفی"),
    (["افزایش قیمت طلا", "رشد طلا", "رکورد طلا", "انس طلا رکورد"], [0, 0, 2, 0, 0, 0], "طلا قوی"),
    (["کاهش قیمت طلا", "افت طلا", "ریزش طلا"], [0, 0, -2, 0, 0, 0], "طلا ضعیف"),
]
NEG = ["عدم", "بدون", "نه ", "تکذیب", "رد شد", "منتفی"]


def normalize(t: str) -> str:
    t = (t or "").replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
    return re.sub(r"\s+", " ", t).strip()


def rule_impact(title: str) -> tuple[np.ndarray, list[str]]:
    t = normalize(title)
    v, why = np.zeros(len(ASSETS)), []
    for kws, eff, label in RULES:
        if any(k in t for k in kws):
            sign = -1 if any(n in t for n in NEG) else 1
            v += sign * np.array(eff, dtype=float)
            why.append(label if sign > 0 else f"نفیِ «{label}»")
    return np.clip(v, -3, 3), why


# ============================================================ تشخیص نماد در خبر
def link_symbols(title: str, names: dict[str, str]) -> list[str]:
    """names: {نماد: نام شرکت}. نماد کوتاه فقط اگر به‌صورت کلمه مستقل آمده باشد."""
    t = normalize(title)
    words = set(re.findall(r"[\w]+", t))
    hits = []
    for sym, nm in names.items():
        if len(sym) >= 3 and sym in words:
            hits.append(sym)
        elif nm and len(nm) >= 8 and nm in t:
            hits.append(sym)
    return hits[:5]


# ============================================================ ذخیره و برچسب‌گذاری
def _con():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.execute("CREATE TABLE IF NOT EXISTS news(title TEXT PRIMARY KEY, d TEXT, source TEXT, link TEXT, rule TEXT)")
    return c


def store(items: list[dict]) -> None:
    c, d = _con(), date.today().isoformat()
    for it in items:
        c.execute("INSERT OR IGNORE INTO news VALUES(?,?,?,?,?)",
                  (it["title"], d, it.get("source", ""), it.get("link", ""), json.dumps(it.get("impact", []))))
    c.commit(); c.close()


def _labeled(pricestore) -> tuple[list[str], np.ndarray, np.ndarray]:
    """خبرهای روز d با تغییر شاخص کل و دلار از d تا اولین روز ثبت‌شده بعدی برچسب می‌خورند."""
    c = _con()
    rows = c.execute("SELECT title, d, rule FROM news").fetchall()
    c.close()
    X, y_real, y_rule = [], [], []
    for title, d, rule in rows:
        ch = [pricestore.next_change(n, d) for n in ("tedpix", "usd_irr")]
        r = json.loads(rule or "[]") or [0] * len(ASSETS)
        X.append(title)
        y_rule.append([np.sign(r[0]), np.sign(r[1])])
        y_real.append([np.sign(ch[0]) if ch[0] is not None and abs(ch[0]) > 0.3 else np.nan,
                       np.sign(ch[1]) if ch[1] is not None and abs(ch[1]) > 0.3 else np.nan])
    return X, np.array(y_real, dtype=float), np.array(y_rule, dtype=float)


# ============================================================ شبکه عصبی خودآموز
class NewsBrain:
    def __init__(self):
        self.models, self.info = {}, {}

    def train(self, pricestore) -> dict:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.neural_network import MLPClassifier
        except ImportError:
            self.info = {"status": "scikit-learn نصب نیست"}
            return self.info
        X, y_real, y_rule = _labeled(pricestore)
        if len(X) < 40:
            self.info = {"status": f"داده کافی نیست ({len(X)} خبر ذخیره‌شده؛ حداقل ۴۰)"}
            return self.info
        vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2, max_features=20000, sublinear_tf=True)
        Xv = vec.fit_transform(X)
        for j, target in enumerate(["بورس", "دلار"]):
            real = ~np.isnan(y_real[:, j])
            # برچسب واقعی بازار وزن ۳، برچسب قواعد وزن ۱ (فقط برای خبرهایی که برچسب واقعی ندارند)
            y = np.where(real, y_real[:, j], y_rule[:, j])
            use = y != 0
            n_real = int((real & use).sum())
            if use.sum() < 30 or len(set(y[use])) < 2:
                self.info[target] = {"status": "برچسب کافی نیست", "real_labels": n_real}
                continue
            idx = np.where(use)[0]
            sw = np.where(real[idx], 3.0, 1.0)
            reps = np.repeat(idx, sw.astype(int))  # MLP وزن نمونه ندارد → تکرار نمونه‌های واقعی
            m = MLPClassifier(hidden_layer_sizes=(64, 16), max_iter=300, early_stopping=len(reps) > 200,
                              random_state=0, alpha=1e-3)
            m.fit(Xv[reps], y[reps])
            acc = None
            if n_real >= 30:
                ri = np.where(real & use)[0]
                acc = float((m.predict(Xv[ri]) == y[ri]).mean())
            self.models[target] = m
            self.info[target] = {"samples": int(use.sum()), "real_labels": n_real,
                                 "train_acc_on_real": round(acc, 2) if acc is not None else None,
                                 "trust": "بالا" if n_real >= 500 else "متوسط" if n_real >= 150 else "پایین (هنوز بیشتر از قواعد تقلید می‌کند)"}
        self.vec = vec
        try:
            import pickle
            MODEL.write_bytes(pickle.dumps((vec, self.models, self.info)))
        except Exception:  # noqa: BLE001
            pass
        return self.info

    def predict(self, titles: list[str]) -> dict[str, np.ndarray]:
        if not self.models:
            return {}
        Xv = self.vec.transform(titles)
        out = {}
        for k, m in self.models.items():
            p = m.predict_proba(Xv)
            cls = list(m.classes_)
            up = p[:, cls.index(1.0)] if 1.0 in cls else 0
            dn = p[:, cls.index(-1.0)] if -1.0 in cls else 0
            out[k] = up - dn   # بین -۱ و +۱
        return out


# ============================================================ ParsBERT (اختیاری)
_bert = None


def bert_sentiment(titles: list[str], model: str) -> list[float] | None:
    global _bert
    try:
        if _bert is None:
            import os
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
            from transformers import pipeline
            _bert = pipeline("text-classification", model=model, truncation=True)
        res = _bert(titles, batch_size=16)
        out = []
        for r in res:
            lab = r["label"].lower()
            s = r["score"] if any(x in lab for x in ["pos", "happy", "1"]) else -r["score"] if any(x in lab for x in ["neg", "sad", "0"]) else 0
            out.append(round(float(s), 2))
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("ParsBERT در دسترس نیست: %s", e)
        return None


# ============================================================ اجرای کامل
def analyze(items: list[dict], symbol_names: dict[str, str], pricestore, cfg: dict) -> dict:
    for it in items:
        v, why = rule_impact(it["title"])
        it["impact"] = v.round(1).tolist()
        it["why"] = why
        it["symbols"] = link_symbols(it["title"], symbol_names)
    store(items)
    brain = NewsBrain()
    info = brain.train(pricestore)
    titles = [it["title"] for it in items]
    nn = brain.predict(titles) if titles else {}
    for i, it in enumerate(items):
        it["nn"] = {k: round(float(v[i]), 2) for k, v in nn.items()}
    if cfg.get("use_parsbert") and titles:
        bs = bert_sentiment(titles, cfg.get("parsbert_model", "HooshvareLab/bert-fa-base-uncased-sentiment-deepsentipers-binary"))
        if bs:
            for it, s in zip(items, bs):
                it["bert"] = s
    # جمع‌بندی: میانگین اثر روی هر بازار، فقط خبرهای دارای اثر
    M = np.array([it["impact"] for it in items]) if items else np.zeros((0, len(ASSETS)))
    active = (np.abs(M).sum(axis=1) > 0) if len(M) else np.array([])
    agg = {a: round(float(M[active, j].mean()), 2) if active.any() else 0.0 for j, a in enumerate(ASSETS)}
    nn_agg = {k: round(float(np.mean(v)), 2) for k, v in nn.items()}
    themes = {}
    for it in items:
        for w in it["why"]:
            themes[w] = themes.get(w, 0) + 1
    by_symbol = {}
    for it in items:
        for s in it["symbols"]:
            by_symbol.setdefault(s, []).append(it["title"])
    return {"impact": agg, "nn": nn_agg, "nn_info": info, "themes": dict(sorted(themes.items(), key=lambda x: -x[1])),
            "by_symbol": by_symbol, "n": len(items), "n_relevant": int(active.sum()) if len(M) else 0}
