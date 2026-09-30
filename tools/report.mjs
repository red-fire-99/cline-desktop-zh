#!/usr/bin/env node
/**
 * report.mjs —— 界面汉化覆盖报告（只读，不修改页面）
 * 统计当前界面的中文/英文文案数量，列出未翻译的候选文案。
 * 用法: node tools/report.mjs [--port 9223]
 */
import { portFromArgv } from './config.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = portFromArgv();

const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) {
  console.log(`未发现页面目标（端口 ${PORT}）。请确认已通过“Cline 中文版”启动器启动 Cline。`);
  process.exit(1);
}
const target = targets.find((t) => /tauri\.localhost|localhost/.test(t.url || '')) || targets[0];

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const expr = `(() => {
  // 跳过代码块 / 输入框 / 富文本(聊天内容与 Agent 回复)
  const SKIP = 'pre, code, kbd, samp, textarea, [contenteditable="true"], [contenteditable=""], [class*="prose"], [class*="markdown"], [class*="cm-editor"], [class*="monaco"]';
  const visible = (el) => el && el.offsetParent !== null;
  const zh = []; const en = []; const attrs = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    if (el.closest(SKIP)) continue;
    const v = n.nodeValue.trim();
    if (!v || v.length > 200) continue;
    if (/[\\u4e00-\\u9fff]/.test(v)) zh.push(v);
    else if (/[A-Za-z]{2}/.test(v)) en.push(v);
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    if (!visible(el)) continue;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute(a);
      if (!v) continue;
      if (/[\\u4e00-\\u9fff]/.test(v)) zh.push(v);
      else if (/[A-Za-z]{2}/.test(v)) attrs.push(a + ': ' + v);
    }
  }
  const dict = window.__CLINE_ZH_DICT__ || {};
  const uniq = (a) => [...new Set(a)];
  const isUi = (s) => !/^(https?:|www\\.|\\/|[A-Za-z]:\\\\)/.test(s)
    && !/^[a-z0-9_.@/-]+$/i.test(s)
    && !/^[\\d .%px,:+-]+$/.test(s)
    && !/^(Cmd|Ctrl|Shift|Alt|Esc|Enter|Tab|F\\d)$/.test(s);
  return JSON.stringify({
    url: location.href,
    injected: !!window.__clineZh,
    dictSize: Object.keys(dict).length,
    zhCount: zh.length,
    enCount: en.length,
    attrEnCount: attrs.length,
    enSample: uniq(en.filter(isUi)).slice(0, 40),
    attrSample: uniq(attrs).slice(0, 15),
    zhSample: uniq(zh).slice(0, 10)
  });
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const data = JSON.parse(r.result.value);
ws.close();

const totalTexts = data.zhCount + data.enCount;
const pct = totalTexts ? ((data.zhCount / totalTexts) * 100).toFixed(1) : '0.0';

console.log('=== Cline 界面汉化覆盖报告 ===');
console.log(`页面          : ${data.url}`);
console.log(`翻译器已挂载  : ${data.injected ? '是' : '否（Cline 可能不是用启动器启动的）'}`);
console.log(`词典词条数    : ${data.dictSize}`);
console.log(`可见文案      : 中文 ${data.zhCount} 条 / 英文 ${data.enCount} 条  → 中文占比 ${pct}%`);
console.log(`英文属性文案  : ${data.attrEnCount} 条`);
if (data.zhSample.length) console.log(`\n中文样例: ${data.zhSample.slice(0, 6).map((s) => JSON.stringify(s)).join(', ')}`);
if (data.enSample.length) {
  console.log(`\n未翻译样例（共 ${data.enSample.length} 条，前 20 条）:`);
  for (const s of data.enSample.slice(0, 20)) console.log('  - ' + s);
}
if (data.attrSample.length) {
  console.log('\n未翻译属性样例:');
  for (const s of data.attrSample) console.log('  - ' + s);
}

const outDir = join(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'coverage-report.txt');
writeFileSync(outFile, [
  `时间: ${new Date().toISOString()}`,
  `页面: ${data.url}`,
  `翻译器已挂载: ${data.injected}`,
  `词典词条数: ${data.dictSize}`,
  `可见文案: 中文 ${data.zhCount} / 英文 ${data.enCount} (中文占比 ${pct}%)`,
  `英文属性文案: ${data.attrEnCount}`,
  '',
  '=== 未翻译文本 ===',
  ...data.enSample,
  '',
  '=== 未翻译属性 ===',
  ...data.attrSample,
  ''
].join('\n'), 'utf8');
console.log(`\n报告已写入: ${outFile}`);
