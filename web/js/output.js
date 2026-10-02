/* تحلیل با Claude (پرامپت دستی یا API)، اعلان تلگرام/بله. */
(function (IM) {
  const { U, Net } = IM;
  const O = {};

  O.SYSTEM_PROMPT = 'تو تحلیلگر ارشد بازار سرمایه ایران هستی (بورس، فرابورس، صندوق‌ها، اوراق خزانه و گام، اختیار معامله، سکه و طلا، ارز) ' +
    'و اثر بازارهای جهانی (نفت، طلا، فلزات، دلار، رمزارزها) و اخبار سیاسی/اقتصادی ایران را می‌شناسی. داده‌های زیر خروجی یک سامانه خودکار است. کارهای تو: ' +
    '۱) سیگنال‌های خرید/فروش را نقد کن و آن‌هایی که با اخبار و شرایط کلان تناقض دارند را مشخص کن؛ ' +
    '۲) بهترین ۳ فرصت خرید و مهم‌ترین ریسک‌ها را با دلیل، حد ضرر و افق زمانی بگو؛ ' +
    '۳) سناریوی کوتاه‌مدت دلار، سکه و شاخص کل را بنویس؛ ' +
    '۴) اگر داده‌ای مشکوک یا ناقص است بگو. پاسخ فارسی، فشرده و کاربردی. ' +
    'این تحلیل توصیه قطعی سرمایه‌گذاری نیست؛ احتمالات و ریسک را صریح بگو.';

  O.buildPrompt = snapshot => O.SYSTEM_PROMPT + '\n\n```json\n' + JSON.stringify(snapshot, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 1) + '\n```';

  /** برمی‌گرداند {prompt, text}. در حالت manual فقط پرامپت (text=null). */
  O.runLlm = async (snapshot, cfg) => {
    const prompt = O.buildPrompt(snapshot);
    if ((cfg.mode || 'manual') !== 'api') return { prompt, text: null };
    if (!cfg.api_key) { console.warn('llm.api_key خالی است'); return { prompt, text: null }; }
    const body = { model: cfg.model || 'claude-sonnet-5-5', max_tokens: cfg.max_tokens || 2500, system: O.SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'داده‌های امروز:\n```json\n' + prompt.split('```json\n')[1] }] };
    if (cfg.use_web_search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.api_key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const msg = await r.json();
      return { prompt, text: (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') };
    } catch (e) { console.warn('Claude API error:', e.message); return { prompt, text: null, error: e.message }; }
  };

  /** یک سؤال ساده از Claude با کلید API (بدون جستجوی وب). خروجی: متن پاسخ */
  O.ask = async (prompt, cfg, maxTokens = 2000) => {
    if (!cfg || cfg.mode !== 'api' || !cfg.api_key) throw new Error('حالت api یا کلید API در تنظیمات (llm) نیست');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.api_key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw new Error(`Claude: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    return ((await r.json()).content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  };

  O.formatAlert = s => {
    let t = `${s.fa_action} | ${s.symbol} (${s.market})\nامتیاز: ${s.score}`;
    if (s.price) t += ` | قیمت: ${U.fmt(s.price)}`;
    if (s.stop) t += `\nحد ضرر: ${U.fmt(s.stop)} | هدف: ${U.fmt(s.target)}`;
    return t + '\n• ' + s.reasons.slice(0, 6).join('\n• ');
  };

  O.send = async (text, ncfg) => {
    for (const [name, base] of [['telegram', 'https://api.telegram.org'], ['bale', 'https://tapi.bale.ai']]) {
      const c = (ncfg || {})[name];
      if (!c || !c.enabled || !c.bot_token || !c.chat_id) continue;
      try {
        for (let i = 0; i < text.length; i += 3800) {
          const r = await fetch(`${base}/bot${c.bot_token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: c.chat_id, text: text.slice(i, i + 3800) }) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
        }
      } catch (e) { console.warn(`ارسال ${name} ناموفق:`, e.message); }
    }
  };

  IM.Out = O;
})(window.IM = window.IM || {});
