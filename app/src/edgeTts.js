const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const WebSocket = require('../vendor/ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '1-130.0.2849.68';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓（女，温柔）',
  'zh-CN-XiaoyiNeural': '晓伊（女，活泼）',
  'zh-CN-YunxiNeural': '云希（男，阳光）',
  'zh-CN-YunyangNeural': '云扬（男，沉稳）'
};
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

function secMsGec() {
  const WIN_EPOCH = 11644473600;
  const S_TO_NS = 1e9;
  let ticks = (Date.now() / 1000 + WIN_EPOCH) * S_TO_NS / 100;
  ticks = ticks - (ticks % 3000000000); // 5 分钟一档
  return crypto.createHash('sha256').update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase();
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function toRatePercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '+0%';
  const pct = Math.round((n - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}
function toPitchPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '+0%';
  const pct = Math.round((n - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'tts-cache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

async function synthesize(text, opts = {}) {
  text = String(text || '').trim();
  if (!text) throw new Error('TTS 文本为空');
  const voice = EDGE_VOICES[opts.voice] ? opts.voice : DEFAULT_VOICE;
  const rate = toRatePercent(opts.rate);
  const pitch = toPitchPercent(opts.pitch);
  const key = crypto.createHash('sha256').update(`${voice}|${rate}|${pitch}|${text}`).digest('hex');
  const file = path.join(cacheDir(), `edge-${key}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 100) {
    return { ok: true, file, url: pathToFileURL(file).href, cached: true, voice };
  }

  const gec = secMsGec();
  const connectionId = crypto.randomUUID();
  const url = `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return await new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const timestamp = new Date().toUTCString();
    const timeout = setTimeout(() => finish(new Error('Edge TTS 连接超时')), 25000);

    let ws;
    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws && ws.close(); } catch {}
      if (err) { reject(err); return; }
      if (!chunks.length) { reject(new Error('Edge TTS 没有返回音频')); return; }
      try {
        fs.writeFileSync(file, Buffer.concat(chunks));
        resolve({ ok: true, file, url: pathToFileURL(file).href, cached: false, voice });
      } catch (e) { reject(e); }
    }

    try {
      ws = new WebSocket(url, {
        origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-MS-GEC': gec,
          'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION
        }
      });
    } catch (e) { finish(e); return; }

    ws.on('open', () => {
      const config = JSON.stringify({
        context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        } } }
      });
      ws.send(
        `X-Timestamp:${timestamp}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' + config
      );
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
        `<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${escapeXml(text)}</prosody></voice></speak>`;
      ws.send(
        `X-RequestId:${requestId}\r\n` +
        'Content-Type:application/ssml+xml\r\n' +
        `X-Timestamp:${timestamp}\r\n` +
        'Path:ssml\r\n\r\n' + ssml
      );
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const s = data.toString();
        if (s.includes('Path:turn.end')) finish(null);
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (buf.length < 2 + headerLen) return;
      const header = buf.slice(2, 2 + headerLen).toString('utf8');
      if (header.includes('Path:audio')) chunks.push(buf.slice(2 + headerLen));
    });

    ws.on('error', (e) => finish(e));
    ws.on('close', () => { if (!settled) finish(chunks.length ? null : new Error('Edge TTS 连接被关闭')); });
  });
}

module.exports = { synthesize, EDGE_VOICES, DEFAULT_VOICE };
