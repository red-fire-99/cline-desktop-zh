// 定向采集: 设置 -> 自定义 页面的全部二级标签页
import { portFromArgv } from './config.mjs';
const PORT = portFromArgv();
const fs = await import('node:fs');
const path = await import('node:path');
fs.mkdirSync(path.join(import.meta.dirname, 'out'), { recursive: true });
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.log('应用未运行'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  const v = r.result.value;
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 打开设置 -> 自定义
const open = await evalJson(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const btn = [...dlg.querySelectorAll('button, a, [role="menuitem"], [role="tab"]')].find(e => e.offsetParent !== null && /^(自定义|Customize)$/.test(e.textContent.trim()));
  if (!btn) return JSON.stringify('no customize btn');
  btn.click();
  return JSON.stringify('ok');
})()`);
console.log('打开自定义:', open);
await sleep(1200);

// 2) 枚举自定义面板内的全部可点击标签
const tabs = await evalJson(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const els = [...dlg.querySelectorAll('button, a, [role="tab"], [role="menuitem"]')]
    .filter(e => e.offsetParent !== null && e.textContent.trim() && e.textContent.trim().length <= 30);
  return JSON.stringify([...new Set(els.map(e => e.textContent.trim()))]);
})()`);
console.log('可见标签:', tabs);

// 2) 确保停在自定义页, 枚举横向分类标签(带计数: 工具10/插件0/...) + 已安装/市场
const dumpTabs = await evalJson(`(() => {
  const norm = (s) => String(s).replace(/\\s+/g, '');
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const els = [...dlg.querySelectorAll('button, a, [role="tab"]')]
    .filter(e => e.offsetParent !== null && norm(e.textContent));
  return JSON.stringify([...new Set(els.map(e => norm(e.textContent)))]);
})()`);
const wanted = dumpTabs.filter((t) => /^(工具|插件|技能|规则|MCP|钩子|Installed|Marketplace|已安装|市场)/.test(t.replace(/\d+$/, '')));
console.log('横向标签:', wanted);

// 先采集纵向子页(已安装/市场), 再回退到自定义总览采集横向标签
const horiz = wanted.filter((t) => /^(工具|插件|技能|规则|MCP|钩子)/.test(t.replace(/\d+$/, '')));
const pages = wanted.filter((t) => !horiz.includes(t));

// 3) 逐个点击并抓取
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'zh-cn.json'), 'utf8'));
const allLines = new Set();
async function captureTab(target) {
  const clicked = await evalJson(`(() => {
    const norm = (s) => String(s).replace(/\\s+/g, '');
    const dlg = document.querySelector('[role="dialog"]') || document.body;
    const els = [...dlg.querySelectorAll('button, a, [role="tab"]')].filter(e => e.offsetParent !== null && norm(e.textContent) === ${JSON.stringify(target)});
    if (!els.length) return JSON.stringify('gone');
    els[0].click();
    return JSON.stringify('ok');
  })()`);
  if (clicked !== 'ok') { console.log('跳过(未找到):', target); return; }
  await sleep(900);
  const d = await evalJson(`(() => {
    const dlg = document.querySelector('[role="dialog"]') || document.body;
    const attrs = [...new Set([...dlg.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')).filter(Boolean))];
    return JSON.stringify({ text: dlg.innerText, attrs });
  })()`);
  const safe = target.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 30) || 'tab';
  fs.writeFileSync(path.join(import.meta.dirname, 'out', `cust-${safe}.txt`), d.text + '\n\n=== 属性文案 ===\n' + d.attrs.join('\n'), 'utf8');
  for (const l of [...d.text.split('\n'), ...d.attrs]) {
    const t = l.trim();
    if (t && /[A-Za-z]{2}/.test(t) && !/[\u4e00-\u9fff]/.test(t) && !(t in dict)) allLines.add(t);
  }
  console.log('已采集:', target);
}
for (const target of pages) {
  try { await captureTab(target); } catch (e) { console.log('跳过:', target, e.message.slice(0, 100)); }
}
// 回退自定义总览
await evalJson(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const btn = [...dlg.querySelectorAll('button, a, [role="tab"]')].find(e => e.offsetParent !== null && /^(自定义|Customize)$/.test(e.textContent.trim()));
  if (btn) btn.click();
  return JSON.stringify('ok');
})()`);
await sleep(900);
for (const target of horiz) {
  try { await captureTab(target); } catch (e) { console.log('跳过:', target, e.message.slice(0, 100)); }
}
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'cust-untranslated.txt'), [...allLines].join('\n'), 'utf8');
console.log('\n未翻译行', allLines.size, '条 -> out\\cust-untranslated.txt');
ws.close();
process.exit(0);
