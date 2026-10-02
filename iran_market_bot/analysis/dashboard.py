"""داشبورد HTML تک‌فایلی (بدون اینترنت قابل باز شدن): همه بازارها در تب‌های جدا، جدول‌های قابل مرتب‌سازی و جستجو."""
from __future__ import annotations

import html
import json
import math
from datetime import date, datetime
from pathlib import Path

import pandas as pd


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else round(v, 2)
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return str(v)[:10]
    if hasattr(v, "item"):
        try:
            return _clean(v.item())
        except Exception:  # noqa: BLE001
            return str(v)
    return v


def table(df, cols: dict | None = None, limit: int | None = None) -> dict:
    """DataFrame یا لیست دیکشنری → {cols:[[key,label]], rows:[[...]]}"""
    if df is None:
        return {"cols": [], "rows": []}
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    if df.empty:
        return {"cols": [], "rows": []}
    if cols:
        keep = [c for c in cols if c in df.columns]
        df = df[keep]
        labels = [[c, cols[c]] for c in keep]
    else:
        labels = [[c, c] for c in df.columns]
    if limit:
        df = df.head(limit)
    rows = [[_clean(v) if not isinstance(v, (list, dict)) else json.dumps(v, ensure_ascii=False) for v in r]
            for r in df.itertuples(index=False, name=None)]
    return {"cols": labels, "rows": rows}


CSS = """
:root{--bg:#f5f6f8;--card:#fff;--fg:#151a22;--mut:#5d6675;--bd:#e3e6eb;--acc:#1f5eff;--up:#0a8a43;--dn:#cc2a2a;--upbg:#e8f7ee;--dnbg:#fdecec}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--fg:#e8eaee;--mut:#9aa3b2;--bd:#2a2f38;--acc:#6f9bff;--up:#3ccf7b;--dn:#ff6b6b;--upbg:#12301f;--dnbg:#3a1717}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 Vazirmatn,Tahoma,sans-serif;direction:rtl}
header{padding:14px 16px;border-bottom:1px solid var(--bd);background:var(--card);position:sticky;top:0;z-index:3}
h1{margin:0;font-size:18px}header small{color:var(--mut)}
nav{display:flex;gap:4px;overflow-x:auto;padding:8px 12px;background:var(--card);border-bottom:1px solid var(--bd);position:sticky;top:58px;z-index:2}
nav button{border:1px solid var(--bd);background:transparent;color:var(--fg);border-radius:999px;padding:5px 12px;white-space:nowrap;cursor:pointer;font:inherit}
nav button.on{background:var(--acc);border-color:var(--acc);color:#fff}
main{padding:12px 16px;max-width:1500px;margin:auto}section{display:none}section.on{display:block}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px;margin:0 0 12px}
.card h3{margin:0 0 8px;font-size:15px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.kpi{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px}.kpi b{display:block;font-size:17px}.kpi span{color:var(--mut);font-size:12px}
.tw{overflow-x:auto;max-height:70vh}table{border-collapse:collapse;width:100%;font-size:13px}
th{position:sticky;top:0;background:var(--card);cursor:pointer;text-align:right;padding:6px;border-bottom:2px solid var(--bd);white-space:nowrap}
td{padding:5px 6px;border-bottom:1px solid var(--bd);white-space:nowrap}td.w{white-space:normal;min-width:240px}
.up{color:var(--up)}.dn{color:var(--dn)}tr.buy{background:var(--upbg)}tr.sell{background:var(--dnbg)}
input.q,select.q{padding:6px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;margin:0 0 8px 6px}
pre{white-space:pre-wrap;font:inherit;margin:0}a{color:var(--acc)}.mut{color:var(--mut)}
"""

JS = r"""
const D = JSON.parse(document.getElementById('data').textContent);
const fmt = v => { if (v===null||v===undefined||v==='') return '—';
  if (typeof v==='number'){ const a=Math.abs(v); return a>=1000? v.toLocaleString('en-US',{maximumFractionDigits:0}) : v.toLocaleString('en-US',{maximumFractionDigits:2}); }
  return String(v); };
const signCols = /chg|change|flow|vs_market|premium|impact|nn_|score|بورس|دلار|طلا|نفت|مسکن|خودرو/;
function render(el, t, opts={}){
  if(!t||!t.cols||!t.cols.length){ el.innerHTML='<p class="mut">داده‌ای نیست.</p>'; return; }
  let rows=t.rows.slice(), sortI=-1, asc=false, q='', cat='';
  const catI = opts.filterCol!==undefined ? t.cols.findIndex(c=>c[0]===opts.filterCol) : -1;
  const wrap=document.createElement('div');
  const tools=document.createElement('div');
  const inp=document.createElement('input'); inp.className='q'; inp.placeholder='جستجو…'; tools.appendChild(inp);
  if(catI>=0){ const s=document.createElement('select'); s.className='q';
    s.innerHTML='<option value="">همه</option>'+[...new Set(rows.map(r=>r[catI]))].sort().map(c=>`<option>${c}</option>`).join('');
    s.onchange=()=>{cat=s.value;draw()}; tools.appendChild(s); }
  const cnt=document.createElement('span'); cnt.className='mut'; tools.appendChild(cnt);
  const tw=document.createElement('div'); tw.className='tw'; wrap.append(tools,tw); el.innerHTML=''; el.appendChild(wrap);
  inp.oninput=()=>{q=inp.value.trim();draw()};
  const actI=t.cols.findIndex(c=>c[0]==='action');
  function draw(){
    let r=rows.filter(x=>(!q||x.join(' ').includes(q))&&(!cat||x[catI]===cat));
    if(sortI>=0) r.sort((a,b)=>{const x=a[sortI],y=b[sortI]; if(x===null) return 1; if(y===null) return -1;
      return (typeof x==='number'&&typeof y==='number'? x-y : String(x).localeCompare(String(y),'fa'))*(asc?1:-1)});
    const lim=opts.limit||800; cnt.textContent=` ${r.length} ردیف`+(r.length>lim?` (نمایش ${lim})`:'');
    let h='<table><tr>'+t.cols.map((c,i)=>`<th data-i="${i}">${c[1]}${i===sortI?(asc?' ▲':' ▼'):''}</th>`).join('')+'</tr>';
    for(const x of r.slice(0,lim)){
      const act = actI>=0 ? (x[actI]||'') : '';
      h+=`<tr class="${act.includes('خرید')?'buy':act.includes('فروش')?'sell':''}">`+x.map((v,i)=>{
        const k=t.cols[i][0]; let cls=''; if(typeof v==='number'&&signCols.test(k)) cls=v>0?'up':v<0?'dn':'';
        if(k==='link'&&v) return `<td><a href="${v}" target="_blank" rel="noopener">باز کردن</a></td>`;
        const wide = typeof v==='string'&&v.length>45;
        return `<td class="${cls}${wide?' w':''}">${fmt(v)}</td>`}).join('')+'</tr>';
    }
    tw.innerHTML=h+'</table>';
    tw.querySelectorAll('th').forEach(th=>th.onclick=()=>{const i=+th.dataset.i; asc = sortI===i? !asc : false; sortI=i; draw();});
  }
  draw();
}
document.querySelectorAll('[data-t]').forEach(el=>{ const t=D.tables[el.dataset.t]; render(el,t,{filterCol:el.dataset.f,limit:+el.dataset.l||undefined}); });
const btns=document.querySelectorAll('nav button'), secs=document.querySelectorAll('section');
btns.forEach(b=>b.onclick=()=>{btns.forEach(x=>x.classList.toggle('on',x===b)); secs.forEach(s=>s.classList.toggle('on',s.id===b.dataset.s)); window.scrollTo(0,0);});
"""


def build(path: Path, title: str, kpis: list[tuple[str, str, str]], tabs: list[tuple[str, str, list]], tables: dict) -> Path:
    """tabs: [(id, عنوان, بلوک‌ها)] ؛ بلوک: ("table", عنوان, کلید جدول, filterCol|None) یا ("html", عنوان, html) یا ("text", عنوان, متن)"""
    nav = "".join(f'<button data-s="{tid}" class="{"on" if i == 0 else ""}">{html.escape(t)}</button>' for i, (tid, t, _) in enumerate(tabs))
    secs = []
    for i, (tid, _, blocks) in enumerate(tabs):
        parts = []
        if i == 0 and kpis:
            parts.append('<div class="grid" style="margin-bottom:12px">' + "".join(
                f'<div class="kpi"><span>{html.escape(k)}</span><b class="{c}">{html.escape(v)}</b></div>' for k, v, c in kpis) + "</div>")
        for b in blocks:
            if b[0] == "table":
                f = f' data-f="{b[3]}"' if len(b) > 3 and b[3] else ""
                parts.append(f'<div class="card"><h3>{html.escape(b[1])}</h3><div data-t="{b[2]}"{f}></div></div>')
            elif b[0] == "html":
                parts.append(f'<div class="card"><h3>{html.escape(b[1])}</h3>{b[2]}</div>')
            elif b[0] == "text":
                parts.append(f'<div class="card"><h3>{html.escape(b[1])}</h3><pre>{html.escape(b[2])}</pre></div>')
        secs.append(f'<section id="{tid}" class="{"on" if i == 0 else ""}">{"".join(parts)}</section>')
    data = json.dumps({"tables": tables}, ensure_ascii=False, default=str).replace("</", "<\\/")
    page = f"""<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{CSS}</style></head><body>
<header><h1>{html.escape(title)}</h1><small>به‌روزرسانی: {datetime.now():%Y-%m-%d %H:%M} — خروجی خودکار و آموزشی؛ توصیه سرمایه‌گذاری نیست.</small></header>
<nav>{nav}</nav><main>{"".join(secs)}</main>
<script type="application/json" id="data">{data}</script><script>{JS}</script></body></html>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page, encoding="utf-8")
    return path
