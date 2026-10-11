/* preload.js（gametest 专用）—— 只暴露两件事：写 JSONL 日志、ESC 退出 ✓（contextIsolation ✓） */
'use strict';
const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const OUT = 'C:/deepseek/gametest/clicks.jsonl';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
contextBridge.exposeInMainWorld('gameTestLog', (rec) => {
  try { fs.appendFileSync(OUT, JSON.stringify(Object.assign({ t: Date.now() }, rec)) + '\n'); } catch (e) {}
});
contextBridge.exposeInMainWorld('gameTestQuit', () => { try { ipcRenderer.send('gametest:quit'); } catch (e) {} });
