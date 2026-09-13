const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const file = () => path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  ttsEnabled: true,
  ttsStyle: 'tsundere',
  ttsVoice: '',
  ttsRate: 1.02,
  ttsPitch: 1.18,
  vocabLevel: 'high_school',
  assistant: 'off',
  petMode: 'idle',
  petScale: 1
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^\uFEFF/, '')) }; }
  catch { return { ...DEFAULTS }; }
}

function save(patch) {
  const next = { ...load(), ...patch };
  try { fs.writeFileSync(file(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}

module.exports = { load, save, DEFAULTS, file };
