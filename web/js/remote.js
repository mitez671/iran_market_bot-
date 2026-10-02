/* ارتباط صفحه با سرور محلی ترموکس: سایت‌های خواسته‌شده را آنجا می‌گیرد و پیشرفت را جریانی (NDJSON) برمی‌گرداند.
   جایگزین Collect.run می‌شود (Collect.remote). منطق انتخاب سایت‌ها و دسته‌ی VPN همچنان در صفحه است. */
(function (IM) {
  const R = { base: '' };   // base خالی = همان مبدأ صفحه (http://127.0.0.1:8787)

  /** ensure(): async، true اگر سرور در دسترس است. خروجی: bundle به‌روزشده */
  R.run = async (cfg, bundle, ids, hooks = {}, ensure) => {
    if (ensure && !(await ensure())) throw new Error('سرور ترموکس در دسترس نیست. در Termux بزن: sh start-termux.sh   و صفحه را از http://127.0.0.1:8787 باز کن.');
    const { llm, notify, ...safeCfg } = cfg;                 // کلید API و توکن‌ها به سرور نمی‌روند
    const resp = await fetch(R.base + '/api/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cfg: safeCfg, ids }) });
    if (!resp.ok) throw new Error(`سرور ترموکس: HTTP ${resp.status} ${(await resp.text()).slice(0, 120)}`);
    const reader = resp.body.getReader(), dec = new TextDecoder();
    let buf = '', final = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.type === 'progress') { if (hooks.progress) hooks.progress(m.done, m.total, m.id); }
        else if (m.type === 'done') final = m.sources;
        else if (m.type === 'error') throw new Error(m.message);
      }
    }
    if (!final) throw new Error('پاسخ سرور ناقص بود (ارتباط قطع شد؟)');
    for (const id of ids) {
      const e = final[id]; if (!e) continue;
      const prev = bundle.sources[id];                       // دریافت ناموفق، داده‌ی موفق قبلی را پاک نمی‌کند
      bundle.sources[id] = e.ok ? e : { ok: false, msg: e.msg, t: prev && prev.t, tryT: e.tryT, data: prev && prev.data };
    }
    return bundle;
  };
  IM.Remote = R;
})(window.IM = window.IM || {});
