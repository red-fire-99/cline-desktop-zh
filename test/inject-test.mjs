// inject-test.mjs —— 对任意 Chromium/WebView2 页面做一次注入并校验翻译结果
// 用法: node _test/inject-test.mjs [port]
const fs = await import('node:fs');
const path = await import('node:path');

const PORT = Number(process.argv[2] || 9411);
const root = path.join(import.meta.dirname, '..');
const dict = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'zh-cn.json'), 'utf8'));
const translator = fs.readFileSync(path.join(root, 'tools', 'translator.js'), 'utf8');
const injectSrc = `window.__CLINE_ZH_DICT__=${JSON.stringify(dict)};\n${translator}\n`;

const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.error('no page target on port ' + PORT); process.exit(2); }

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m.result); this.pending.delete(m.id); }
    });
  }
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new Cdp(ws)));
      ws.addEventListener('error', () => rej(new Error('ws error')));
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch {} }
}

const cdp = await Cdp.connect(targets[0].webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injectSrc });
await cdp.send('Runtime.evaluate', { expression: injectSrc, returnByValue: true });
await new Promise((r) => setTimeout(r, 1500)); // 等 MutationObserver / 定时补翻跑完

const probe = `(() => {
  const txt = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; };
  const attr = (s, a) => { const el = document.querySelector(s); return el ? el.getAttribute(a) : null; };
  return JSON.stringify({
    '按钮 #btn-new': txt('#btn-new'),
    '标题 #title': txt('#title'),
    '计数 #count (正则词条)': txt('#count'),
    '搜索框 placeholder': attr('#search', 'placeholder'),
    '删除按钮 title': attr('#del', 'title'),
    '动态插入文本': txt('#dyn-text'),
    '动态属性 aria-label': attr('#dyn-attr', 'aria-label'),
    '代码块(应保持英文)': txt('#code'),
    '输入框 placeholder': attr('#ta', 'placeholder'),
    '插件已安装': typeof window.__clineZh
  });
})()`;
const r = await cdp.send('Runtime.evaluate', { expression: probe, returnByValue: true });
const out = JSON.parse(r.result.value);
console.log('=== 注入结果 ===');
for (const [k, v] of Object.entries(out)) console.log(`${k}: ${JSON.stringify(v)}`);

const hasHan = (s) => !!s && /[\u4e00-\u9fff]/.test(s);
const checks = [
  ['按钮翻译', hasHan(out['按钮 #btn-new'])],
  ['标题翻译', hasHan(out['标题 #title'])],
  ['正则词条翻译', hasHan(out['计数 #count (正则词条)'])],
  ['placeholder 翻译', hasHan(out['搜索框 placeholder'])],
  ['title 属性翻译', hasHan(out['删除按钮 title'])],
  ['动态文本翻译', hasHan(out['动态插入文本'])],
  ['动态属性翻译', hasHan(out['动态属性 aria-label'])],
  ['代码块未被翻译', (out['代码块(应保持英文)'] || '').includes('"Settings"')],
  ['翻译器已挂载', out['插件已安装'] === 'object'],
];
let ok = true;
for (const [name, pass] of checks) { if (!pass) ok = false; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`); }
cdp.close();
console.log(ok ? '\n全部通过 ✔' : '\n存在失败项 ✘');
process.exit(ok ? 0 : 1);
