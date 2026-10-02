// 将最新 translator.js + zh-cn.json 热更新到运行中的实例(重载翻译器, 支持正则词条)
import { portFromArgv } from './config.mjs';
const PORT = portFromArgv();
const fs = await import('node:fs');
const path = await import('node:path');
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'dict', 'zh-cn.json'), 'utf8'));
const fragPath = path.join(import.meta.dirname, '..', 'dict', 'fragments.json');
const frags = fs.existsSync(fragPath) ? fs.readFileSync(fragPath, 'utf8') : '{}';
const translator = fs.readFileSync(path.join(import.meta.dirname, 'translator.js'), 'utf8');
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.log('未发现页面, 应用未运行。'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
// 优先走页内 setDict() 热更新（不重新注册观察器/定时器，节点缓存会自动失效）；
// 只有页面里还没有新版翻译器时，才退回整段重新注入。
const expr = `(() => {
  const dict = ${JSON.stringify(dict)};
  const frag = ${frags};
  if (window.__clineZh && typeof window.__clineZh.setDict === 'function' && (window.__clineZh.version || 0) >= 3) {
    window.__clineZh.setDict(dict, frag);
    return JSON.stringify({ ok: true, mode: 'setDict', size: Object.keys(window.__CLINE_ZH_DICT__).length,
      fragSize: Object.keys(window.__CLINE_ZH_FRAG__).length, stats: window.__clineZh.stats() });
  }
  window.__clineZh = undefined;
  window.__CLINE_ZH_DICT__ = dict;
  window.__CLINE_ZH_FRAG__ = frag;
  ${translator}
  return JSON.stringify({ ok: true, mode: 'reinject', size: Object.keys(window.__CLINE_ZH_DICT__).length,
    fragSize: Object.keys(window.__CLINE_ZH_FRAG__).length });
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log('热更新结果:', r.result.value);
ws.close();
process.exit(0);
