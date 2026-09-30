// 找漏: 抓取当前屏幕上所有未翻译的英文文案, 生成待翻译清单
// 用法: 把 Cline 停在没翻译的页面(可保持菜单/弹窗打开), 运行: node find.mjs
import { portFromArgv } from './config.mjs';
const PORT = portFromArgv();
const fs = await import('node:fs');
const path = await import('node:path');
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'dict', 'zh-cn.json'), 'utf8'));
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.log('未发现页面, 请先用 以中文启动Cline.cmd 启动应用。'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });

const expr = `(() => {
  const dict = window.__CLINE_ZH_DICT__ || {};
  const found = new Map(); // text -> [{kind, detail}]
  function add(t, kind, detail) {
    t = (t || '').trim();
    if (!t || t.length > 300) return;
    if (!/[A-Za-z]{2}/.test(t) || /[\\u4e00-\\u9fff]/.test(t)) return;
    if (dict[t]) return; // 已有词典(可能因富文本拆分没命中)
    const key = kind + ':' + t;
    if (!found.has(key)) found.set(key, []);
  }
  // 可见文本节点(逐节点, 含被富文本拆分的片段)
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    const el = n.parentElement;
    if (!el || !el.offsetParent) continue;
    if (el.closest('pre, code, textarea, kbd, [contenteditable], [class*="prose"], [class*="markdown"]')) continue;
    const v = n.nodeValue.trim();
    if (v) add(v, 'text', (el.tagName + '.' + String(el.className).slice(0, 40)));
  }
  // 属性文案
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    if (!el.offsetParent) continue;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      add(el.getAttribute(a), 'attr:' + a, el.tagName);
    }
  }
  const rows = [...found.keys()].map((k) => { const [kind, ...rest] = k.split(':'); return { kind, text: rest.join(':') }; });
  rows.sort((a, b) => a.text.length - b.text.length);
  return JSON.stringify(rows);
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const rows = JSON.parse(r.result.value);

// 过滤明显的非文案: URL/路径/命令/ID/版本号/纯符号
function isUiText(s) {
  if (/^(http|www\.|\/|~\/|[A-Za-z]:\\)/.test(s)) return false;
  if (/^[a-z0-9_.@/-]+$/i.test(s) && !/\s/.test(s)) return false;
  if (/^[\d .%px,:+-]+$/.test(s)) return false;
  if (/^(Cmd|Ctrl|Shift|Alt|Esc|Enter|Tab|F\d)$/.test(s)) return false;
  return true;
}
const ui = rows.filter((x) => isUiText(x.text));
const rest = rows.filter((x) => !isUiText(x.text));

const lines = ui.map((x) => `[${x.kind}] ${x.text}`);
const tpl = ui.map((x) => `  ${JSON.stringify(x.text)}: "",`);
const out = [
  `发现 ${ui.length} 条待翻译文案(另有 ${rest.length} 条疑似非文案, 见文件末尾):`,
  '',
  ...lines,
  '',
  '=== 以下疑似非文案(路径/命令/标识符等, 一般无需翻译) ===',
  ...rest.map((x) => `[${x.kind}] ${x.text}`),
].join('\n');
const outDir = path.join(import.meta.dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'todo.txt'), out, 'utf8');
fs.writeFileSync(path.join(outDir, 'todo-template.json'), tpl.join('\n'), 'utf8');
console.log(`发现 ${ui.length} 条待翻译文案 (${rest.length} 条非文案已过滤到文件末尾)`);
console.log('待翻清单: out\\todo.txt');
console.log('词典模板: out\\todo-template.json (填上中文后发给我或自己合入 zh-cn.json)');
console.log('');
console.log(lines.slice(0, 30).join('\n') || '(当前页面没有发现未翻译文案)');
ws.close();
process.exit(0);
