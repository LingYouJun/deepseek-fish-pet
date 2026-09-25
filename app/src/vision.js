// 视觉模型调用：把截图 + 问题发给一个 OpenAI 兼容的多模态模型，让它"看懂"画面。
// 配置在 config.json 的 visionBase / visionKey / visionModel（默认阿里云百炼的 qwen-vl）。
async function describe(cfg, imageDataUrl, question) {
  const base = String(cfg.visionBase || '').replace(/\/+$/, '');
  const key = String(cfg.visionKey || '');
  const model = cfg.visionModel || 'qwen-vl-max';
  if (!base || !key) throw new Error('未配置视觉模型');

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${body}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content || '';
}

module.exports = { describe };
