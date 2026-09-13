# 大肥鱼桌宠 · app

Electron 源码目录。

```powershell
npm install
npm start       # 开发调试
npm run pack    # 生成未打包目录 app/dist
npm run dist:release  # 生成 NSIS 安装包到 ../../release
```

主要入口：

- `main.js`：主进程
- `preload.js`：contextBridge API
- `src/`：LLM、记忆、心情、生词、DSH、网页助手
- `renderer/`：桌宠窗口 `index.html` 与聊天窗口 `chat.html`
- `assets/pet-character.png`：立绘，替换后重启即可
