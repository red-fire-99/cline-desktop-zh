// 临时验证: 检查界面骨架是否已翻译, 统计英文 UI 残留
import { portFromArgv } from './config.mjs';
const PORT = portFromArgv();
async function getJson(p) { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return r.json(); }
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.p.has(m.id)) { const { res } = this.p.get(m.id); this.p.delete(m.id); res(m.result); } }); }
  static connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.addEventListener('open', () => res(new Cdp(ws))); ws.addEventListener('error', rej); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.p.set(id, { res }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch {} }
}
const targets = (await getJson('/json/list')).filter((t) => t.type === 'page');
const t = targets[0];
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
const expr = `(() => {
  const pat = /^(Sessions?|Settings?|Schedule|Schedules|Customize|New Session|New session|Delete|Cancel|Close|Search sessions|Loading\\.\\.\\.|Minimize|Maximize|Notifications \\(F8\\)|Toggle Sidebar|Account settings|Show more|Send message|Home|Personal|Free|Delete session|Rename|General|Theme)$/;
  const left = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const v = w.currentNode.nodeValue.trim();
    const el = w.currentNode.parentElement;
    const vis = el && el.offsetParent !== null && !el.closest('pre,code,textarea,[contenteditable]');
    if (v && vis && pat.test(v)) left.push(v);
  }
  const zh = [];
  const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w2.nextNode()) {
    const v = w2.currentNode.nodeValue.trim();
    const el = w2.currentNode.parentElement;
    const vis = el && el.offsetParent !== null && !el.closest('pre,code,textarea,[contenteditable]');
    if (v && vis && /^[\\u4e00-\\u9fff]/.test(v) && v.length <= 12) zh.push(v);
  }
  return JSON.stringify({ enLeftovers: [...new Set(left)], zhUiSample: [...new Set(zh)].slice(0, 40) });
})()`;
const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(r.result.value);
cdp.close();
