#!/usr/bin/env node
/**
 * scan-ui-strings.mjs —— 扫描 Cline 前端资源，找出「词典还没覆盖」的英文文案
 *
 * 原理: 通过 CDP 在已打开的页面里读取已加载的 JS 资源（不重启应用、不打断会话），
 *       抽取其中的英文文案字面量，与 dict/zh-cn.json + dict/fragments.json 比对，
 *       输出仍需翻译的候选清单（按出现频次排序）。
 *
 * 用法: node tools\scan-ui-strings.mjs [--port 9223] [--limit 120] [--out tools\out\ui-strings-missing.txt]
 */
import { portFromArgv } from './config.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = portFromArgv();
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = Number(opt('limit', 120));
const OUT = opt('out', join(import.meta.dirname, 'out', 'ui-strings-missing.txt'));

function readFileSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }
const dict = JSON.parse(readFileSafe(join(import.meta.dirname, '..', 'dict', 'zh-cn.json')) || '{}');
const fragPath = join(import.meta.dirname, '..', 'dict', 'fragments.json');
const frags = existsSync(fragPath) ? JSON.parse(readFileSafe(fragPath) || '{}') : {};
const fragKeys = Object.keys(frags);
const dictKeys = new Set(Object.keys(dict));

const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
if (!targets.length) { console.error(`未发现页面（端口 ${PORT}）。请先以中文模式启动 Cline。`); process.exit(1); }
const target = targets.find((t) => /tauri\.localhost/.test(t.url || '')) || targets[0];
console.log(`页面: ${target.url}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败'))); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

// ① 页面里已加载的 JS 资源（+ 常见 manifest 里的 chunk）
const listExpr = `(() => {
  const urls = performance.getEntriesByType('resource').map(r => r.name).filter(u => /\\.(js|mjs)(\\?|$)/.test(u));
  const inline = [...document.querySelectorAll('script[src]')].map(s => s.src);
  return JSON.stringify([...new Set([...urls, ...inline])]);
})()`;
const listRes = await send('Runtime.evaluate', { expression: listExpr, returnByValue: true });
let urls = JSON.parse(listRes.result.value || '[]');
console.log(`已加载脚本: ${urls.length} 个`);

// ② 逐个抓取文本（在页面内 fetch，同源，避免跨域问题）
const chunks = [];
const BATCH = 4;
for (let i = 0; i < urls.length; i += BATCH) {
  const batch = urls.slice(i, i + BATCH);
  const expr = `(async () => { const urls = ${JSON.stringify(batch)}; const out = [];
    for (const u of urls) { try { const t = await fetch(u).then(r => r.text()); out.push({ u, len: t.length, t }); } catch (e) { out.push({ u, len: 0, t: '' }); } }
    return JSON.stringify(out); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 });
  try { chunks.push(...JSON.parse(r.result.value || '[]')); } catch { /* 忽略该批 */ }
  process.stdout.write(`\r  已抓取 ${Math.min(i + BATCH, urls.length)}/${urls.length}`);
}
process.stdout.write('\n');
const totalBytes = chunks.reduce((s, c) => s + (c.len || 0), 0);
console.log(`抓取完成: ${chunks.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
ws.close();

// ③ 抽取英文文案字面量 + 过滤噪声（只保留「像界面文案」的）
const CODE_CHARS = /[{}<>=+|~`$\\;]|=>|\|\||::/;
const NOISE = [
  /^(punctuation|variable|keyword|support|constant|string|entity)\./,     // 代码高亮 token
  /^(use strict|typeof |instanceof |new |null|true|false|undefined|void)\b/,
  /invalid_type|invalid_string|invalid_union|invalid_value|localeError|safe integer|Async schemas|No object generated/i,
  /Expected .* to (have|be|be defined|match)|to have been given|received:|expected: Received/i,
  /\b(flex|grid|inline-flex|items-center|justify-center|text-|bg-|border-|size-\d|shrink-0|animate-|hover:|w-\d|h-\d|p-\d|m-\d|gap-|rounded-|font-|opacity-|translate-|absolute|relative)\b/,
  /\.(js|ts|tsx|css|svg|png|webp)(\?|$)/,
  /^https?:|^\/|^[A-Za-z]:\\|localhost|\/api\/|\/v1\/|api\./,
  /^[A-Z_]{3,}$/,                        // 全大写常量
  /\b(localhost|React|ReactDOM|useState|useEffect|useMemo|useRef|Props|Children|State|Event|Promise|Error|Object|Array|String|Number|Boolean|Symbol|Reflect|Proxy|RegExp|JSON|Math|Date|Map|Set|WeakMap|WeakSet|Float32|Float64|Uint8|Int32|ArrayBuffer|process|window|document|navigator|globalThis)\b/,
];
const NOISE_RE = new RegExp(NOISE.map((r) => r.source).join('|'), 'i');

const counts = new Map();
function looksLikeUiCopy(s) {
  if (!s || s.length < 3 || s.length > 90) return false;
  if (!/^[A-Za-z0-9 ,.'":;!@#$%^&*()\[\]{}<>?\/+=~\u2192-]+$/.test(s)) return false;  // 纯 ASCII/常见标点（允许 →）
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (CODE_CHARS.test(s)) return false;
  if (NOISE_RE.test(s)) return false;
  const words = s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length >= 2) return true;                                   // 至少两个词 → 像句子/标签
  return /^[A-Z][a-z]{2,13}$/.test(s.trim());                           // 单个词：只留驼峰式 UI 词
}
for (const c of chunks) {
  if (!c.t) continue;
  for (const m of c.t.matchAll(/"((?:[^"\\\n]|\\.){3,90})"/g)) {
    let s;
    try { s = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    if (!looksLikeUiCopy(s)) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
}
console.log(`候选文案（去重后）: ${counts.size} 条`);

// ④ 与词典比对：整条未命中、且不包含任何已翻译片段
const missing = [];
for (const [s, n] of counts) {
  if (dictKeys.has(s)) continue;
  if (fragKeys.some((k) => s.includes(k))) continue;
  if (fragKeys.some((k) => frags[k] && s.includes(k))) continue;
  missing.push([s, n]);
}
missing.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
console.log(`\n词典未覆盖: ${missing.length} 条（显示前 ${Math.min(LIMIT, missing.length)} 条）`);
for (const [s, n] of missing.slice(0, LIMIT)) console.log(`  ${String(n).padStart(3)}x  ${JSON.stringify(s)}`);

const outDir = join(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(OUT, missing.map(([s, n]) => `${n}\t${JSON.stringify(s)}`).join('\n') + '\n', 'utf8');
console.log(`\n完整清单: ${OUT}`);