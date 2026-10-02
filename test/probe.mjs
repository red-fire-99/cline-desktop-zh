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

// ---- 回归: 不得覆盖「应用自己更新过的节点」 ----
// 真实故障: 底部「提供商/模型」按钮复用同一 DOM 节点，先渲染占位标签 "Provider"，
// 应用拿到真实值后改成 "Cline Usage-Billing"，二次翻译逻辑却用旧原文把它覆盖成「提供商」，
// 且因为 React 虚拟 DOM 没变化，之后再也不会写回，界面永久看不到具体值。
const guardExpr = `(() => {
  const out = {};
  const el = document.getElementById('combo');

  // 场景 1: 应用改写节点内容 -> 翻译器必须放手
  el.textContent = 'Cline Usage-Billing';
  window.__clineZh.apply();
  window.__clineZh.apply();          // 多跑两轮，确认不会反复覆盖
  out.afterAppUpdate = el.textContent;
  out.okNoClobber = el.textContent === 'Cline Usage-Billing';

  // 场景 2: 二次翻译仍然有效（词典更新后，已翻译的节点应升级为新译文）
  const title = document.getElementById('title');
  const dict = window.__CLINE_ZH_DICT__;
  const orig = dict['Settings'];
  const before = title.textContent;
  dict['Settings'] = before + '-V2';
  window.__clineZh.apply();
  out.retranslate = { before: before, after: title.textContent };
  out.okRetranslate = title.textContent === before + '-V2';
  dict['Settings'] = orig;          // 还原，避免影响其它用例
  window.__clineZh.apply();

  // 场景 3: stats() 必须可用（v1.0.7 之前被整体覆盖导致丢失）
  out.hasStats = typeof window.__clineZh.stats === 'function';
  out.stats = out.hasStats ? window.__clineZh.stats() : null;
  return JSON.stringify(out);
})()`;
const guardRes = await send('Runtime.evaluate', { expression: guardExpr, returnByValue: true });
const g = JSON.parse(guardRes.result.value || '{}');
console.log(`\n回归: 应用改值后未被覆盖 = ${g.okNoClobber ? 'PASS' : 'FAIL'} (${JSON.stringify(g.afterAppUpdate)})`);
console.log(`回归: 二次翻译仍生效     = ${g.okRetranslate ? 'PASS' : 'FAIL'} (${JSON.stringify(g.retranslate)})`);
console.log(`回归: stats() 可用        = ${g.hasStats ? 'PASS' : 'FAIL'}`);

const ok = o.injected && /[\u4e00-\u9fff]/.test(o.btn || '') && /[\u4e00-\u9fff]/.test(o.count || '') && /[\u4e00-\u9fff]/.test(o.ph || '') && /[\u4e00-\u9fff]/.test(o.dyn || '')
  && g.okNoClobber && g.okRetranslate && g.hasStats;
// 输出 ASCII 判定标记：调用方（PowerShell）用纯 ASCII 匹配，避免中文编码问题导致误判
console.log('VERIFY-RESULT: ' + (ok ? 'PASS' : 'FAIL'));
console.log(ok ? 'cline-zh.mjs 注入链验证通过 ✔' : 'cline-zh.mjs 注入链验证失败 ✘');
ws.close();
process.exit(ok ? 0 : 1);
