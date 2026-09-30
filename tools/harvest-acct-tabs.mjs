// 点击账户横向标签(overview/usage/billing)并采集每页内容
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
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'zh-cn.json'), 'utf8'));
const allLines = new Set();
for (const label of ['overview', 'usage', 'billing']) {
  try {
    const clicked = await evalJson(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(e => e.offsetParent && e.textContent.trim() === ${JSON.stringify(label)});
      if (!btns.length) return JSON.stringify('gone');
      btns[0].scrollIntoView({ block: 'center' });
      btns[0].click();
      return JSON.stringify('ok');
    })()`);
    if (clicked !== 'ok') { console.log('跳过(未找到):', label); continue; }
    await sleep(1200);
    const d = await evalJson(`(() => {
      const main = document.querySelector('main') || document.body;
      const attrs = [...new Set([...document.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')).filter(Boolean))];
      return JSON.stringify({ text: main.innerText, attrs });
    })()`);
    const safe = 'acct-' + label;
    fs.writeFileSync(path.join(import.meta.dirname, 'out', `${safe}.txt`), d.text + '\n\n=== 属性文案 ===\n' + d.attrs.join('\n'), 'utf8');
    for (const l of [...d.text.split('\n'), ...d.attrs]) {
      const t = l.trim();
      if (t && /[A-Za-z]{2}/.test(t) && !/[\u4e00-\u9fff]/.test(t) && !(t in dict)) allLines.add(t);
    }
    console.log('已采集:', label, `(${d.text.length} 字符)`);
  } catch (e) { console.log('跳过:', label, e.message.slice(0, 120)); }
}
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'acct-tabs-untranslated.txt'), [...allLines].join('\n'), 'utf8');
console.log('\n未翻译行', allLines.size, '条 -> out\\acct-tabs-untranslated.txt');
ws.close();
process.exit(0);
