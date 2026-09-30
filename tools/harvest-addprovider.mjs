// 采集: 设置 -> API 提供商 -> 添加提供商 弹窗
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
  if (r.exceptionDetails) throw new Error('page: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  const v = r.result.value;
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 打开设置 -> 切到 API 提供商页 -> 点添加提供商
async function clickInDlg(predDesc, pred) {
  return evalJson(`(() => {
    const norm = (s) => String(s).replace(/\\s+/g, '');
    const dlg = document.querySelector('[role="dialog"]') || document.body;
    const btn = [...dlg.querySelectorAll('button, a, [role="tab"]')].find(e => e.offsetParent !== null && ${pred});
    if (btn) btn.click();
    return JSON.stringify(btn ? 'ok' : 'gone');
  })()`);
}
await evalJson(`(() => {
  let btn = [...document.querySelectorAll('[aria-label="设置"], [title="设置"]')].find(e => e.offsetParent);
  if (!document.querySelector('[role="dialog"]') && btn) btn.click();
  return JSON.stringify('ok');
})()`);
await sleep(900);
console.log('切到 API 提供商:', await clickInDlg('api', `/API/.test(e.textContent.trim()) || norm(e.textContent) === 'API提供商'`));
await sleep(1000);
const opened = await evalJson(`(() => {
  const dlg = document.querySelectorAll('[role="dialog"]');
  const scope = dlg.length > 1 ? dlg[dlg.length - 1] : (dlg[0] || document.body);
  const norm = (s) => String(s).replace(/\\s+/g, '');
  const btns = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && ['添加提供商', 'Addprovider', '添加'].some(t => norm(e.textContent).startsWith(t)));
  if (!btns.length) return JSON.stringify('no add btn');
  btns[btns.length - 1].click();
  return JSON.stringify('ok');
})()`);
console.log('打开添加提供商:', opened);
await sleep(1200);

// 2) 抓取最上层弹窗内容
const d = await evalJson(`(() => {
  const dlgs = [...document.querySelectorAll('[role="dialog"]')];
  const scope = dlgs.length > 1 ? dlgs[dlgs.length - 1] : (dlgs[0] || document.body);
  const attrs = [...new Set([...scope.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')).filter(Boolean))];
  return JSON.stringify({ text: scope.innerText, attrs });
})()`);
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'add-provider.txt'), d.text + '\n\n=== 属性文案 ===\n' + d.attrs.join('\n'), 'utf8');
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'zh-cn.json'), 'utf8'));
const missing = [];
for (const l of [...d.text.split('\n'), ...d.attrs]) {
  const t = l.trim();
  if (t && /[A-Za-z]{2}/.test(t) && !/[\u4e00-\u9fff]/.test(t) && !(t in dict)) missing.push(t);
}
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'add-provider-untranslated.txt'), [...new Set(missing)].join('\n'), 'utf8');
console.log('\n=== 文本 ===\n' + d.text.slice(0, 2500));
console.log('\n=== 属性 ===\n' + d.attrs.join('\n'));
console.log('\n=== 未翻译(已在词典外) ===');
console.log([...new Set(missing)].join('\n') || '(无)');
ws.close();
process.exit(0);
