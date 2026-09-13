// 网页操控：Playwright 驱动一个受控浏览器（懒加载，未安装时报错不崩溃）
const path = require('path');
let packed = false;
try { packed = require('electron').app.isPackaged; } catch {}
const browsersPath = packed && process.resourcesPath
  ? path.join(process.resourcesPath, '.pw-browsers')
  : path.join(__dirname, '..', '.pw-browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || browsersPath;

let browser = null, page = null;

async function ensure() {
  if (page) return;
  const { chromium } = require('playwright');
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' });
  page = await ctx.newPage();
}

async function close() {
  try { await browser?.close(); } catch {}
  browser = null; page = null;
}

async function describe() {
  const title = await page.title().catch(() => '');
  const url = page.url();
  const text = await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
  const clean = String(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
  return `🌐 ${title}\n${url}\n\n${clean}`;
}

async function run(tool, arg) {
  await ensure();
  if (tool === 'web_open') {
    let url = String(arg || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(700);
    return describe();
  }
  if (tool === 'web_click') {
    await page.click(String(arg || '').trim(), { timeout: 8000 });
    await page.waitForTimeout(900);
    return describe();
  }
  if (tool === 'web_type') {
    const s = String(arg || '');
    const i = s.indexOf('||');
    const sel = i > 0 ? s.slice(0, i).trim() : 'input';
    const text = i > 0 ? s.slice(i + 2) : s;
    await page.fill(sel, text, { timeout: 8000 });
    return `✅ 已在「${sel}」输入：${text}`;
  }
  if (tool === 'web_read') return describe();
  throw new Error('未知网页操作：' + tool);
}

module.exports = { run, close };
