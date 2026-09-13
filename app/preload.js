const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, (_e, data) => cb(data));
}

contextBridge.exposeInMainWorld('petAPI', {
  // 桌宠窗口
  startDrag: () => ipcRenderer.send('drag-start'),
  move: (x, y) => ipcRenderer.send('drag-move', { x, y }),
  endDrag: (x, y) => ipcRenderer.send('drag-end', { x, y }),
  quit: () => ipcRenderer.send('quit'),
  onSay: (cb) => on('pet:say', cb),
  onSayHello: (cb) => on('pet:say-hello', cb),
  onAction: (cb) => on('pet:action', cb),
  onMode: (cb) => on('pet:mode', cb),
  onScale: (cb) => on('pet:scale', cb),
  onSkin: (cb) => on('pet:skin', cb),
  onDirection: (cb) => on('pet:direction', cb),
  onTtsConfig: (cb) => on('tts:config', cb),
  setScale: (scale) => ipcRenderer.send('pet:set-scale', scale),
  onChatState: (cb) => {
    ipcRenderer.on('chat:opened', () => cb(true));
    ipcRenderer.on('chat:closed', () => cb(false));
  },
  openChat: () => ipcRenderer.send('chat:open'),
  action: (type, payload = {}) => ipcRenderer.send('pet:action', { type, ...payload }),
  resize: (h, bubbleH, w) => ipcRenderer.send('pet:resize', { h, bubbleH, w }),
  shot: () => ipcRenderer.send('pet:shot'),
  chatShot: () => ipcRenderer.send('chat:shot'),
  // 配置
  configGet: () => ipcRenderer.invoke('config:get'),
  configSet: (patch) => ipcRenderer.invoke('config:set', patch),
  configTest: (patch) => ipcRenderer.invoke('config:test', patch),
  // 对话
  chatSend: (payload) => ipcRenderer.invoke('chat:send', payload),
  chatGreet: () => ipcRenderer.invoke('chat:greet'),
  // 人设
  personaGet: () => ipcRenderer.invoke('persona:get'),
  personaSet: (patch) => ipcRenderer.invoke('persona:set', patch),
  // 记忆
  memoryGet: () => ipcRenderer.invoke('memory:get'),
  memoryDelete: (ref) => ipcRenderer.invoke('memory:delete', ref),
  moodGet: () => ipcRenderer.invoke('mood:get'),
  moodAdjust: (d) => ipcRenderer.invoke('mood:adjust', d),
  assistantRun: (a) => ipcRenderer.invoke('assistant:run', a),
  dshState: () => ipcRenderer.invoke('dsh:state'),
  vocabList: () => ipcRenderer.invoke('vocab:list'),
  vocabAdd: (w) => ipcRenderer.invoke('vocab:add', w),
  vocabDel: (w) => ipcRenderer.invoke('vocab:del', w),
  vocabReview: (w, ok) => ipcRenderer.invoke('vocab:review', w, ok)
});

