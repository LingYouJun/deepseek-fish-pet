/* registry.js 的单元测试 —— 纯 Node
 * 跑法：node app/scripts/test-registry.js
 */
const REG = require('../src/registry');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '   ' + extra : '')); }
}

console.log('=== registry.js 单元测试（纯 Node）===');

/* §1 注册与查询 */
{
  const r = REG.create();
  r.register('tool', 'click', { tier: 'full', needsArg: true });
  ok(r.has('tool', 'click'), '§1 注册后能查到');
  ok(r.get('tool', 'click').tier === 'full', '§1 元信息原样保留');
  ok(REG.create().has('tool', 'click') === false, '§1 不同实例互不干扰');
  ok(r.list('tool').length === 1, '§1 list 正常');
  let threw = false;
  try { r.register('', 'x', {}); } catch { threw = true; }
  ok(threw, '§1 缺 kind 时抛错（不静默）');
}

/* §2 ★ 两层：scoped 覆盖 global（近者覆盖，照 cordis ScopedLayers） */
{
  const r = REG.create();
  r.register('tool', 'click', { tier: 'read', note: '全局默认' });
  const sess = r.scoped();
  sess.register('tool', 'click', { tier: 'full', note: '本会话覆盖' });
  ok(sess.get('tool', 'click').tier === 'full', '★ §2 会话层覆盖全局层', sess.get('tool', 'click').note);
  ok(r.get('tool', 'click').tier === 'read', '§2 全局层本身没被改（根注册表只读 global 层）');
  const n = sess.dispose();
  ok(n === 1, '§2 会话 dispose 回收了 1 项', 'n=' + n);
  ok(r.get('tool', 'click').tier === 'read', '§2 回收后回到全局值（覆盖消失）');
  /* 会话层里"自己写的"那一条没了；但 getScoped 会落回 global（这是"近者覆盖"的正常语义，
     不是 bug —— 所以这里查的是 listScoped 里还有没有那一条覆盖） */
  ok(sess.count() === 0, '§2 会话层里自己注册的那一条已经没了', 'count=' + sess.count());
  ok(sess.get('tool', 'click').tier === 'read', '§2 覆盖消失后 sess.get 落回全局值（正常语义）');
}

/* §3 dispose：注册返回 disposer，可单独回收 */
{
  const r = REG.create();
  const d = r.register('tool', 'temp', { tier: 'read' });
  ok(r.has('tool', 'temp'), '§3 注册后存在');
  ok(d() === true, '§3 dispose 返回 true 表示确实删掉了');
  ok(d() === false, '§3 再 dispose 返回 false（幂等）');
  ok(!r.has('tool', 'temp'), '§3 已经不存在');
  const r2 = REG.create();
  r2.register('tool', 'a', {}); r2.register('tool', 'b', {});
  ok(r2.disposeAll() === 2, '§3 disposeAll 一次回收全部');
  ok(r2.list('tool').length === 0, '§3 回收后列表为空');
}

/* §4 on：纯通知 */
{
  const r = REG.create();
  const got = [];
  const off = r.on('turn', (p) => got.push(p));
  ok(r.emit('turn', 1) === 1, '§4 emit 通知到了 1 个监听者');
  ok(got.length === 1 && got[0] === 1, '§4 载荷正确');
  off();
  r.emit('turn', 2);
  ok(got.length === 1, '§4 取消监听后不再收到');
  /* 一个监听者抛错不该影响别人 */
  const got2 = [];
  r.on('x', () => { throw new Error('坏监听者'); });
  r.on('x', (p) => got2.push(p));
  ok(r.emit('x', 9) === 1 && got2[0] === 9, '★ §4 某个监听者抛错不影响其它监听者', 'n=' + r.emit('x', 9));
}

/* §5 waterfall：管道，可改值 */
{
  const r = REG.create();
  r.addWaterfall('prompt', (v) => v + ' A');
  r.addWaterfall('prompt', (v) => v + ' B');
  r.addWaterfall('prompt', () => undefined);        // 返回 undefined = 不改
  ok(r.waterfall('prompt', 'base') === 'base A B', '§5 依次改值，undefined 表示不改', r.waterfall('prompt', 'base'));
  const off = r.addWaterfall('prompt', (v) => v + ' C');
  ok(r.waterfall('prompt', 'x') === 'x A B C', '§5 新加的排在后面');
  off();
  ok(r.waterfall('prompt', 'x') === 'x A B', '§5 取消后不再生效');
}

/* §6 guard：单调否决（不能把 false 变回 true） */
{
  const r = REG.create();
  r.guard((p) => p.tool !== 'rm_rf');
  r.guard((p) => p.tier !== 'full');
  ok(r.allow({ tool: 'click', tier: 'read' }) === true, '§6 都通过时允许');
  ok(r.allow({ tool: 'rm_rf', tier: 'read' }) === false, '§6 被第一个 guard 否决');
  ok(r.allow({ tool: 'click', tier: 'full' }) === false, '§6 被第二个 guard 否决');
  /* ★ 单调性：再加一个"永远返回 true"的 guard，也翻不回 false */
  r.guard(() => true);
  ok(r.allow({ tool: 'rm_rf', tier: 'read' }) === false, '★ §6 guard 是单调否决（true 翻不回 false）');
  /* 抛错的 guard 视为否决（fail closed，照 DSH 的 approval policy） */
  const r2 = REG.create();
  r2.guard(() => { throw new Error('坏了'); });
  ok(r2.allow({}) === false, '★ §6 guard 抛错时按否决处理（fail closed）');
}

/* §7 withTools：全部工具都装好了，而且元信息齐全 */
{
  const r = REG.withTools();
  const tools = r.list('tool');
  ok(tools.length === REG.TOOL_DEFS.length && tools.length > 30, '§7 工具定义全部装好', tools.length + ' 个');
  ok(tools.every((t) => typeof t.tier === 'string' && t.tier), '§7 每个工具都有权限档');
  ok(tools.every((t) => typeof t.needsArg === 'boolean'), '§7 每个工具都声明了是否需要参数');
  ok(tools.every((t) => Number.isFinite(t.timeoutMs)), '§7 每个工具都有超时');
  /* ★ 今天踩过的那个坑：这两个必须是 needsArg:false */
  ok(r.get('tool', 'windows_list').needsArg === false, '★ §7 windows_list 声明"不需要参数"（今天它漏登记导致必报错）');
  ok(r.get('tool', 'template_list').needsArg === false, '★ §7 template_list 同理');
  ok(r.get('tool', 'skill_ls').needsArg === false && r.get('tool', 'proj_ls').needsArg === false, '§7 其它无参工具也都声明了');
  /* 一致性：不该有"需要参数却声明 false"或反之的明显矛盾 */
  const bad = tools.filter((t) => t.needsArg === true && /_ls$|_list$/.test(t.name));
  ok(bad.length === 0, '§7 没有"名字像列表却要求参数"的矛盾声明', bad.map((x) => x.name).join(','));
}

/* §8 同一份定义可以喂给别处（超时表、权限表都从它读） */
{
  const r = REG.withTools();
  const click = r.get('tool', 'click');
  const watch = r.get('tool', 'watch_screen');
  ok(click.timeoutMs === 15000 && watch.timeoutMs === 180000, '§8 超时值就在定义里（timeout.js 可直接读它）', 'click=' + click.timeoutMs + ' watch=' + watch.timeoutMs);
  ok(r.get('tool', 'never_heard_of_it') === null, '§8 没注册过的工具返回 null（调用方自己决定默认值）');
}

/* §9 stats 能看清装了什么 */
{
  const r = REG.withTools();
  const st = r.stats();
  ok(st.kinds.indexOf('tool') >= 0 && st.byKind.tool === REG.TOOL_DEFS.length, '§9 stats 报出种类与数量', JSON.stringify(st.byKind));
}

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
