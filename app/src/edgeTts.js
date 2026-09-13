const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const WebSocket = require('../vendor/ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CRLF = String.fromCharCode(13, 10);

const EDGE_VOICES = {
  'zh-CN-XiaoxiaoNeural': '晓晓（女，温柔）',
  'zh-CN-XiaoyiNeural': '晓伊（女，活泼）',
  'zh-CN-YunxiNeural': '云希（男，阳光）',
  'zh-CN-YunyangNeural': '云扬（男，沉稳）'
};
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

function generateSecMsGecToken() {
  const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
  const ticks = BigInt(Math.floor(Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH)) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  return crypto.createHash('sha256')
    .update(String(roundedTicks) + TRUSTED_CLIENT_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase();
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

function synthesizeOnce(voice, text, outPath, lang, rate, pitch, volume) {
  return new Promise((resolve, reject) => {
    const secMsGec = generateSecMsGecToken();
    const url = `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
    let ws;
    try {
      ws = new WebSocket(url, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
    } catch (e) { reject(e); return; }

    const chunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('timeout')); }
    }, 45000);

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      if (err) { reject(err); return; }
      const buf = Buffer.concat(chunks);
      if (buf.length < 100) { reject(new Error('audio too small: ' + buf.length)); return; }
      try { fs.writeFileSync(outPath, buf); resolve(buf.length); }
      catch (e) { reject(e); }
    }

    ws.on('open', () => {
      const requestId = crypto.randomBytes(16).toString('hex');
      const speechConfig = {
        context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        } } }
      };
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
        `<voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}" volume="${escapeXml(volume || 'default')}">` +
        `${escapeXml(text)}</prosody></voice></speak>`;
      ws.send('Content-Type:application/json; charset=utf-8' + CRLF + 'Path:speech.config' + CRLF + CRLF + JSON.stringify(speechConfig));
      ws.send('X-RequestId:' + requestId + CRLF + 'Content-Type:application/ssml+xml' + CRLF + 'Path:ssml' + CRLF + CRLF + ssml);
    });

    ws.on('message', (data, isBinary) => {
      if (settled) return;
      if (!isBinary) {
        const s = String(data);
        if (s.includes('Path:turn.end')) finish(null);
        return;
      }
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const marker = Buffer.from('Path:audio' + CRLF);
      const idx = raw.indexOf(marker);
      if (idx >= 0) {
        const body = raw.subarray(idx + marker.length);
        if (body.length) chunks.push(body);
      } else if (raw.length) {
        chunks.push(raw);
      }
    });

    ws.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e && e.message || e))));
    ws.on('close', (e) => {
      if (!settled) {
        const code = e && e.code;
        if (chunks.length) finish(null);
        else finish(new Error(`closed early code=${code || ''} reason=${(e && e.reason) || ''}`));
      }
    });
  });
}

async function synthesize(text, opts = {}) {
  text = String(text || '').trim();
  if (!text) throw new Error('TTS 文本为空');
  const voice = EDGE_VOICES[opts.voice] ? opts.voice : DEFAULT_VOICE;
  const rate = toRatePercent(opts.rate);
  const pitch = toPitchPercent(opts.pitch);
  const volume = 'default';
  const lang = voice.split('-').slice(0, 2).join('-') || 'zh-CN';
  const key = crypto.createHash('sha256').update(`${voice}|${rate}|${pitch}|${text}`).digest('hex');
  const file = path.join(cacheDir(), `edge-${key}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 100) {
    return { ok: true, file, url: pathToFileURL(file).href, cached: true, voice };
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await synthesizeOnce(voice, text, file, lang, rate, pitch, volume);
      return { ok: true, file, url: pathToFileURL(file).href, cached: false, voice };
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      if (!msg.includes('1006')) break;
    }
  }
  throw lastErr || new Error('Edge TTS 合成失败');
}

module.exports = { synthesize, EDGE_VOICES, DEFAULT_VOICE };
