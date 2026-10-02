/* رندر داشبورد در مرورگر: تب‌ها، جدول‌های قابل مرتب‌سازی و جستجو. همه مقادیر escape می‌شوند (داده از سایت‌های بیرونی می‌آید). */
(function (IM) {
  const { U } = IM;
  const esc = U.escapeHtml;
  const D = {};
  const SIGN_COLS = /chg|change|gap|erp|vs_ytm|bubble|real|^d30|^d90|^d365|flow|vs_market|premium|impact|nn_|score|بورس|دلار|طلا|نفت|مسکن|خودرو/;
  const fmt = v => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') { const a = Math.abs(v); return v.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : 2 }); }
    return String(v);
  };

  function renderTable(el, t, opts = {}) {
    if (!t || !t.cols || !t.cols.length) { el.innerHTML = '<p class="mut">داده‌ای نیست.</p>'; return; }
    let sortI = -1, asc = false, q = '', cat = '';
    const rows = t.rows;
    const catI = opts.filterCol ? t.cols.findIndex(c => c[0] === opts.filterCol) : -1;
    const actI = t.cols.findIndex(c => c[0] === 'action');
    const cats = catI >= 0 ? [...new Set(rows.map(r => r[catI]))].sort() : [];
    el.innerHTML = `<div class="tools"><input class="q" placeholder="جستجو…" aria-label="جستجو">` +
      (catI >= 0 ? `<select class="q" aria-label="فیلتر"><option value="">همه</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>` : '') +
      `<span class="mut cnt"></span></div><div class="tw"></div>`;
    const inp = el.querySelector('input'), sel = el.querySelector('select'), cnt = el.querySelector('.cnt'), tw = el.querySelector('.tw');
    inp.oninput = () => { q = inp.value.trim(); draw(); };
    if (sel) sel.onchange = () => { cat = sel.value; draw(); };
    function draw() {
      let r = rows.filter(x => (!q || x.join(' ').includes(q)) && (!cat || x[catI] === cat));
      if (sortI >= 0) r = [...r].sort((a, b) => {
        const x = a[sortI], y = b[sortI];
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fa')) * (asc ? 1 : -1);
      });
      const lim = opts.limit || 800;
      cnt.textContent = ` ${r.length} ردیف` + (r.length > lim ? ` (نمایش ${lim})` : '');
      let h = '<table><tr>' + t.cols.map((c, i) => `<th data-i="${i}">${esc(c[1])}${i === sortI ? (asc ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>';
      for (const x of r.slice(0, lim)) {
        const act = actI >= 0 ? String(x[actI] || '') : '';
        h += `<tr class="${act.includes('خرید') ? 'buy' : act.includes('فروش') ? 'sell' : ''}">` + x.map((v, i) => {
          const k = t.cols[i][0];
          if (k === 'link') { const u = U.safeUrl(v); return u ? `<td><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">باز کردن</a></td>` : '<td>—</td>'; }
          const cls = typeof v === 'number' && SIGN_COLS.test(k) ? (v > 0 ? 'up' : v < 0 ? 'dn' : '') : '';
          const wide = typeof v === 'string' && v.length > 45 ? ' w' : '';
          return `<td class="${cls}${wide}">${esc(fmt(v))}</td>`;
        }).join('') + '</tr>';
      }
      tw.innerHTML = h + '</table>';
      tw.querySelectorAll('th').forEach(th => { th.onclick = () => { const i = +th.dataset.i; asc = sortI === i ? !asc : false; sortI = i; draw(); }; });
    }
    draw();
  }

  function newsBlock(d) {
    const cls = v => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
    const kp = d.impact.map(([a, v]) => `<div class="kpi"><span>اثر اخبار بر ${esc(a)}</span><b class="${cls(v)}">${v >= 0 ? '+' : ''}${v.toFixed(2)}</b></div>`).join('');
    return `<div class="grid">${kp}</div><p>${d.themes.map(([k, v]) => `${esc(k)} (${v})`).join(' · ')}</p>` +
      `<p class="mut">مدل خودآموز: ${esc(JSON.stringify(d.info))}</p>`;
  }

  /** view = {kpis, tabs, tables}. meta.extra = [{id, title, render(el)}] تب‌های سفارشی (مثل «منابع و VPN») */
  D.render = (root, view, meta = {}) => {
    const { kpis, tabs, tables } = view, extra = meta.extra || [];
    const all = tabs.map(t => ({ id: t[0], title: t[1] })).concat(extra.map(e => ({ id: e.id, title: e.title })));
    const on = meta.activeTab && all.some(t => t.id === meta.activeTab) ? meta.activeTab : all[0].id;
    let html = `<nav>${all.map(t => `<button data-s="${esc(t.id)}" class="${t.id === on ? 'on' : ''}">${esc(t.title)}</button>`).join('')}</nav><main>`;
    tabs.forEach(([id, , blocks], i) => {
      html += `<section id="${esc(id)}" class="${id === on ? 'on' : ''}">`;
      if (i === 0 && kpis.length) html += '<div class="grid" style="margin-bottom:12px">' + kpis.map(([k, v, c]) => `<div class="kpi"><span>${esc(k)}</span><b class="${esc(c)}">${esc(v)}</b></div>`).join('') + '</div>';
      for (const b of blocks) {
        if (b[0] === 'table') html += `<div class="card"><h3>${esc(b[1])}</h3><div data-t="${esc(b[2])}"${b[3] ? ` data-f="${esc(b[3])}"` : ''}></div></div>`;
        else if (b[0] === 'news') html += `<div class="card"><h3>${esc(b[1])}</h3>${newsBlock(b[2])}</div>`;
        else if (b[0] === 'text') html += `<div class="card"><h3>${esc(b[1])}</h3><pre>${esc(b[2])}</pre></div>`;
      }
      html += '</section>';
    });
    extra.forEach(e => { html += `<section id="${esc(e.id)}" class="${e.id === on ? 'on' : ''}"><div data-x="${esc(e.id)}"></div></section>`; });
    root.innerHTML = html + '</main>';
    root.querySelectorAll('[data-t]').forEach(el => renderTable(el, tables[el.dataset.t], { filterCol: el.dataset.f }));
    extra.forEach(e => e.render(root.querySelector(`[data-x="${e.id}"]`)));
    const btns = root.querySelectorAll('nav button'), secs = root.querySelectorAll('section');
    btns.forEach(b => { b.onclick = () => {
      btns.forEach(x => x.classList.toggle('on', x === b)); secs.forEach(s => s.classList.toggle('on', s.id === b.dataset.s));
      if (meta.onTab) meta.onTab(b.dataset.s); window.scrollTo(0, 0);
    }; });
  };

  IM.Dashboard = D;
})(window.IM = window.IM || {});
