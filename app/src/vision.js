// 视觉模型调用：把截图 + 问题发给一个 OpenAI 兼容的多模态模型，让它"看懂"画面。
// 默认用 DeepSeek 自己的 deepseek-flash（视觉），复用主模型的 apiBase/apiKey。
// 也可以单独配 visionBase / visionKey / visionModel 换别的多模态模型。
//
// 注意：必须带超时。游戏助手主循环是 await 这个调用的，没有超时的话
// 一次黑洞连接就会让循环既不前进也不响应"停"（stopFlag 只在间隔等待里检查）。
//
// 错误信息复用 llm.js 的翻译（net.wrapNetErr / net.wrapHttpErr）：
//   这里原本自己抛 `HTTP ${status} ${body}` 和裸网络错误 —— 和 llm.js 修之前一模一样。
//   更糟的是 screen_look 那头是 `catch { text = '' }` 静默降级，
//   于是 key 过期 / 余额不足 / 网络不通，用户在界面上只会觉得"她好像没看见"。
const llm = require('./llm');

async function describe(cfg, imageDataUrl, question, detail) {
  const base = String(cfg.visionBase || cfg.apiBase || '').replace(/\/+$/, '');
  const key = String(cfg.visionKey || cfg.apiKey || '');
  const model = cfg.visionModel || 'deepseek-flash';
  if (!base || !key) throw new Error('未配置视觉模型（config.json 里填 visionKey/visionBase，或直接复用主模型的 apiKey）');

  const ms = Math.max(5000, Math.min(300000, Number(cfg.visionTimeoutMs) || 60000));
  let signal;
  try { signal = AbortSignal.timeout(ms); } catch {}
  let res;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: detail || 'low' } },
          ],
        }],
      }),
      /* ⚠️ signal 必须放在 **fetch 的选项**里，不能写进 body 的 JSON。
         我重构这个文件时曾把它挪进 JSON.stringify 里面 —— 结果 AbortSignal.timeout()
         完全失效，一次不响应的请求会挂到 undici 自己的 300 秒默认超时才报错，
         而游戏助手主循环就卡在那儿既不前进也不响应"停"（实测跑了 304.6s）。
         测试里那条"永不响应 → 超时"就是为了守这个。 */
      signal,
    });
  } catch (e) {
    throw llm.net.wrapNetErr(e, ms, base);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw llm.net.wrapHttpErr(res.status, body);
  }
  const json = await res.json().catch((e) => { throw llm.net.wrapNetErr(e, ms, base); });
  return json?.choices?.[0]?.message?.content || '';
}

module.exports = { describe };
