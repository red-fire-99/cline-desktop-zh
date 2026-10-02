// probe.mjs —— 只读取页面翻译状态, 不做任何注入 (用于验证注入器的工作结果)
const PORT = Number(process.argv[2] || 9411);
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.error('no page target on port ' + PORT); process.exit(2); }
const target = targets.find((t) => (t.url || '').includes('page.html')) || targets[0];
console.log('目标页面: ' + target.url);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
const expr = `(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  return JSON.stringify({
    url: location.href,
    injected: !!window.__clineZh,
    dictSize: window.__CLINE_ZH_DICT__ ? Object.keys(window.__CLINE_ZH_DICT__).length : 0,
    btn: t('#btn-new'), title: t('#title'), count: t('#count'),
    ph: document.querySelector('#search') ? document.querySelector('#search').getAttribute('placeholder') : null,
    dyn: t('#dyn-text')
  });
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(r.result.value);
const o = JSON.parse(r.result.value);
// 性能回归: 合成 2000 个文本节点，测量一次全量遍历耗时
const perfExpr = `(() => {
  const box = document.createElement('div');
  box.id = 'zh-perf-probe';
  const samples = ['Settings', 'Delete session', 'Run 3 commands', 'The run failed: rate limit exceeded',
    'some random chat sentence that will never match anything at all', 'https://example.com/a/b/c'];
  for (let i = 0; i < 2000; i++) {
    const d = document.createElement('div');
    d.textContent = samples[i % samples.length] + ' #' + i;
    box.appendChild(d);
  }
  document.body.appendChild(box);
  const t0 = performance.now();
  window.__clineZh.apply();          // 首轮：需要真正翻译
  const first = performance.now() - t0;
  const t1 = performance.now();
  window.__clineZh.apply();          // 二轮：内容未变，应被节点缓存跳过
  const second = performance.now() - t1;
  const stats = window.__clineZh.stats ? window.__clineZh.stats() : null;
  box.remove();
  return JSON.stringify({ firstMs: Math.round(first), cachedMs: Math.round(second), stats });
})()`;
const perfRes = await send('Runtime.evaluate', { expression: perfExpr, returnByValue: true });
const perf = JSON.parse(perfRes.result.value || '{}');
console.log(`\n性能回归: 2000 节点 -> 首轮 ${perf.firstMs}ms / 缓存轮 ${perf.cachedMs}ms`, perf.stats || '');

const ok = o.injected && /[\u4e00-\u9fff]/.test(o.btn || '') && /[\u4e00-\u9fff]/.test(o.count || '') && /[\u4e00-\u9fff]/.test(o.ph || '') && /[\u4e00-\u9fff]/.test(o.dyn || '');
// 输出 ASCII 判定标记：调用方（PowerShell）用纯 ASCII 匹配，避免中文编码问题导致误判
console.log('VERIFY-RESULT: ' + (ok ? 'PASS' : 'FAIL'));
console.log(ok ? 'cline-zh.mjs 注入链验证通过 ✔' : 'cline-zh.mjs 注入链验证失败 ✘');
ws.close();
process.exit(ok ? 0 : 1);
