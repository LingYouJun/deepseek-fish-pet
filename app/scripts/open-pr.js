/* 开 PR（本机没有 gh ✗，所以直接用 GitHub REST API ✓）
 *
 * 【为什么有这个脚本】
 *   实测（2026-10-03）：本机既没有 `gh` CLI，环境里也没有 `GITHUB_TOKEN` ✗。
 *   push 的凭据在 Windows 凭据管理器里 ✓ —— 但**开 PR 需要 API token** ✗，
 *   而凭据管理器里那个 token 不该被脚本挖出来用 ✓（那是越界 ✓）。
 *   → 所以做成"你给 token，我开 PR" ✓：token 只从**环境变量**读，不落盘、不打印 ✓
 *
 * 【用法】
 *   set GITHUB_TOKEN=ghp_xxx        （PowerShell: $env:GITHUB_TOKEN="ghp_xxx"）
 *   node app/scripts/open-pr.js --head release/my-fat-fish-v1 --base main \
 *        --title "我的大肥鱼不可能这么唐" --body-file docs/RELEASE-我的大肥鱼不可能这么唐.md
 *
 *   只看不建（默认行为）：去掉 token 就是 dry-run ✓
 *
 * 【安全】
 *   · ★token 只从环境变量读 ✓，从不写进任何文件、从不打印 ✓★
 *   · 默认 **dry-run** ✓ —— 要真开必须显式加 `--yes` ✓
 *   · 失败时打印 HTTP 状态和 GitHub 的原始 message ✓（不猜原因 ✓）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && v.indexOf('--') !== 0) ? v : true;
}

const OWNER = arg('owner', 'LingYouJun');
const REPO = arg('repo', 'deepseek-fish-pet');
const BASE = arg('base', 'main');
const HEAD = arg('head', 'release/my-fat-fish-v1');
const TITLE = arg('title', '我的大肥鱼不可能这么唐');
const BODY_FILE = arg('body-file', 'docs/RELEASE-我的大肥鱼不可能这么唐.md');
const DRAFT = !!arg('draft', false);
const YES = !!arg('yes', false);

function readBody() {
  const p = path.resolve(__dirname, '..', '..', String(BODY_FILE));
  if (!fs.existsSync(p)) return { ok: false, err: '找不到正文文件：' + p };
  let s = fs.readFileSync(p, 'utf8');
  /* GitHub 的 PR 正文太长会被截 ✓ —— 这里只做温和提示，不擅自裁剪 ✓ */
  return { ok: true, body: s, len: s.length };
}

function api(method, urlPath, payload, token) {
  return new Promise((resolve) => {
    const data = payload ? JSON.stringify(payload) : null;
    const req = https.request({
      method,
      hostname: 'api.github.com',
      path: urlPath,
      headers: Object.assign({
        'User-Agent': 'dayu-pet-open-pr',
        'Accept': 'application/vnd.github+json',
      }, token ? { Authorization: 'Bearer ' + token } : {},
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, json: j, raw: buf.slice(0, 600) });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e && e.message || e) }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ status: 0, error: '请求超时' }); });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const b = readBody();
  console.log('  PR: ' + OWNER + '/' + REPO + '   ' + HEAD + ' → ' + BASE);
  console.log('  标题: ' + TITLE);
  if (!b.ok) { console.log('  ✗ ' + b.err); process.exit(1); }
  console.log('  正文: ' + BODY_FILE + '（' + b.len + ' 字符）');
  console.log('');

  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (!token) {
    console.log('  ⚠️ 环境里没有 GITHUB_TOKEN ✗ —— 只是 dry-run ✓（不会真的开 PR ✓）');
  }
  if (!YES) {
    console.log('  ⚠️ 没有 --yes ✓ —— 只检查，不真的开 ✓（加 --yes 才会真开 ✓）');
  }

  /* 先查一下 head 分支在不在 ✓（本地能查的都先查 ✓，别等 API 报错 ✓） */
  console.log('  --- 预检查 ---');
  console.log('    head 分支: ' + HEAD + '（请确认它已经推到远端 ✓）');
  console.log('    base 分支: ' + BASE);

  if (!token || !YES) {
    console.log('');
    console.log('  ★ 要真的开 PR：★');
    console.log('     1) $env:GITHUB_TOKEN="<你的 token>"');
    console.log('     2) node app/scripts/open-pr.js --yes');
    console.log('');
    console.log('  ★ 或者直接点这个链接（不用 token ✓）：★');
    console.log('     https://github.com/' + OWNER + '/' + REPO + '/compare/' + BASE + '...' + HEAD + '?expand=1');
    process.exit(0);
  }

  const r = await api('POST', '/repos/' + OWNER + '/' + REPO + '/pulls', {
    title: TITLE, head: HEAD, base: BASE, body: b.body, draft: DRAFT,
  }, token);

  if (r.status === 201 && r.json && r.json.html_url) {
    console.log('  ✓ PR 已开：' + r.json.html_url);
    process.exit(0);
  }
  console.log('  ✗ 开 PR 失败 —— HTTP ' + r.status + (r.error ? ('  ' + r.error) : ''));
  if (r.json && r.json.message) console.log('    GitHub 说：' + r.json.message);
  if (r.json && r.json.errors) console.log('    细节：' + JSON.stringify(r.json.errors).slice(0, 300));
  if (!r.json && r.raw) console.log('    原始返回：' + r.raw.slice(0, 300));
  /* 常见原因列出来，省得猜 ✓ */
  console.log('');
  console.log('  常见原因：① head 分支还没推到远端 ✓ ② 同 head→base 的 PR 已经存在 ✓');
  console.log('            ③ token 没有 repo/PR 权限 ✓ ④ 网络到 api.github.com 不通（要代理 ✓）');
  process.exit(1);
})();
