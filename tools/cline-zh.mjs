#!/usr/bin/env node
/**
 * cline-zh —— Cline 桌面端(cline-app.exe)汉化插件
 *
 * 原理: Cline 桌面端是 Tauri 壳 + WebView2 + 内嵌 Brotli 压缩的 Next.js UI。
 * UI 资源被压缩内嵌无法直接改 exe; 但 WebView2 支持 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
 * 环境变量, 可借此开启仅本机的 CDP 调试端口, 向页面注入运行时 DOM 翻译脚本,
 * 按词典把英文界面文本实时替换为中文。不修改 exe, 应用自动更新后仍可使用。
 *
 * 用法:
 *   node cline-zh.mjs dump  [--port 9223] [--exe D:\Cline\cline-app.exe]
 *   node cline-zh.mjs run   [--port 9223] [--dict zh-cn.json] [--exe ...]
 *   node cline-zh.mjs verify [--port 9223]
 *   node cline-zh.mjs kill
 */
import { readConfig } from './config.mjs';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = readConfig();
const DEFAULT_PORT = CFG.port;

// 自动定位 Cline 桌面端安装路径(可用环境变量 CLINE_EXE 或 --exe 参数覆盖)
function detectExe() {
  if (process.env.CLINE_EXE) return process.env.CLINE_EXE;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    local ? join(local, 'Cline', 'cline-app.exe') : '',
    local ? join(local, 'Programs', 'Cline', 'cline-app.exe') : '',
    local ? join(local, 'Programs', 'cline', 'cline-app.exe') : '',
    'C:\\Program Files\\Cline\\cline-app.exe',
    'C:\\Program Files (x86)\\Cline\\cline-app.exe',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}

const args = process.argv.slice(2);
const mode = args[0];
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const PORT = parseInt(opt('port', String(DEFAULT_PORT)), 10);
const EXE = opt('exe', detectExe());
const DICT_FILE = join(__dirname, opt('dict', join('..', 'dict', 'zh-cn.json')));

const log = (...a) => console.log('[cline-zh]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function waitForDevtools(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { await getJson('/json/version'); return true; } catch { await sleep(500); }
  }
  return false;
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, timer } = this.pending.get(m.id);
        clearTimeout(timer); this.pending.delete(m.id);
        m.error ? reject(new Error('cdp: ' + JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('ws 连接失败: ' + url)));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

function isAppRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq cline-app.exe" /NH', { encoding: 'utf8' });
    return /cline-app\.exe/i.test(out);
  } catch { return false; }
}

function spawnApp() {
  const child = spawn(EXE, [], {
    cwd: dirname(EXE), detached: false, stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --lang=${CFG.lang}` },
  });
  child.on('error', (e) => log('启动失败:', e.message));
  return child;
}

function killApp() {
  try { execSync('taskkill /IM cline-app.exe /F', { stdio: 'ignore' }); } catch { /* noop */ }
}

async function listPageTargets() {
  const targets = await getJson('/json/list');
  return targets.filter((t) => (t.type === 'page' || t.type === 'iframe') && !/^devtools:/i.test(t.url || ''));
}
// ---------- 页面内执行的抓取表达式 ----------
const HARVEST_JS = `(() => {
  const urls = performance.getEntriesByType('resource').map(r => r.name)
    .filter(u => /\\.(js|mjs)(\\?|$)/.test(u));
  return JSON.stringify({ href: location.href, title: document.title, urls });
})()`;

const INNER_TEXT_JS = `(() => {
  const vis = document.body ? document.body.innerText : '';
  const ph = [...document.querySelectorAll('[placeholder]')].map(e => e.getAttribute('placeholder'));
  const ti = [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title'));
  const al = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'));
  return JSON.stringify({ vis, ph: [...new Set(ph)], ti: [...new Set(ti)], al: [...new Set(al)] });
})()`;

async function fetchPageAssets(cdp, harvest) {
  const expr = `(async () => {
    const out = [];
    const urls = ${JSON.stringify(harvest.urls)};
    for (const u of urls) {
      try { const t = await fetch(u).then(r => r.text()); out.push({ u, t }); } catch (e) {}
    }
    return JSON.stringify(out);
  })()`;
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return JSON.parse(r.result.value);
}

function extractStrings(js) {
  const found = [];
  const re = /"((?:[^"\\\n]|\\.){2,80})"/g;
  let m;
  while ((m = re.exec(js))) {
    const raw = m[1];
    if (!/[A-Za-z]/.test(raw)) continue;
    let s;
    try { s = JSON.parse('"' + raw + '"'); } catch { continue; }
    found.push(s);
  }
  return found;
}

function looksLikeUiText(s) {
  if (s.length < 2 || s.length > 60) return false;
  if (!/^[A-Za-z0-9 '’.,:!?()&%/+\-–—]+$/.test(s)) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (!/\s/.test(s) && !/^[A-Z]/.test(s)) return false;
  if (/^[A-Z0-9_]+$/.test(s)) return false;
  if (/^(http|www\.|\/|\d)/i.test(s)) return false;
  if (/[A-Za-z0-9+/=]{24,}/.test(s)) return false;
  return true;
}

// ---------- dump 模式: 抓取界面字符串 ----------
async function doDump() {
  if (isAppRunning()) {
    log('警告: Cline 正在运行, 调试端口可能不生效。建议先运行 node cline-zh.mjs kill 后重试。');
  }
  log('启动应用 (调试端口 ' + PORT + ') ...');
  spawnApp();
  if (!(await waitForDevtools())) {
    log('CDP 端口未就绪。请确认应用已完全关闭后重试。');
    process.exit(1);
  }
  const outDir = join(__dirname, 'out');
  mkdirSync(join(outDir, 'js-chunks'), { recursive: true });
  const pages = await listPageTargets();
  log('发现页面目标:', pages.map((t) => t.url).join(', ') || '(无)');
  const allStrings = new Map();
  let pageIdx = 0;
  for (const t of pages) {
    const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
    try {
      await cdp.send('Runtime.enable');
      await sleep(2000);
      const h = JSON.parse((await cdp.send('Runtime.evaluate', { expression: HARVEST_JS, returnByValue: true })).result.value);
      const text = JSON.parse((await cdp.send('Runtime.evaluate', { expression: INNER_TEXT_JS, returnByValue: true })).result.value);
      writeFileSync(join(outDir, `page-${pageIdx}.txt`),
        `URL: ${h.href}\nTITLE: ${h.title}\n\n=== 可见文本 ===\n${text.vis}\n\n=== placeholder ===\n${text.ph.join('\n')}\n\n=== title ===\n${text.ti.join('\n')}\n\n=== aria-label ===\n${text.al.join('\n')}\n`, 'utf8');
      const assets = await fetchPageAssets(cdp, h);
      for (const a of assets) {
        const name = (a.u.split('/').pop() || 'chunk.js').replace(/[^\w.-]/g, '_').slice(0, 80);
        writeFileSync(join(outDir, 'js-chunks', `p${pageIdx}-${name}`), a.t, 'utf8');
        for (const s of extractStrings(a.t)) {
          if (looksLikeUiText(s)) allStrings.set(s, (allStrings.get(s) || 0) + 1);
        }
      }
      pageIdx++;
    } catch (e) {
      log('处理目标失败:', t.url, e.message);
    } finally {
      cdp.close();
    }
  }
  const lines = [...allStrings.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${c}\t${s}`);
  writeFileSync(join(outDir, 'strings-raw.txt'), lines.join('\n'), 'utf8');
  log(`完成: 页面 ${pageIdx} 个, 候选字符串 ${allStrings.size} 条, 输出目录 ${outDir}`);
  killApp();
  process.exit(0);
}
// __PART_B__
// ---------- 注入 ----------
function buildInjectSource(dict) {
  const translator = readFileSync(join(__dirname, 'translator.js'), 'utf8');
  return `window.__CLINE_ZH_DICT__=${JSON.stringify(dict)};\n${translator}\n`;
}

async function attachAndInject(t, injectSrc) {
  const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injectSrc });
  try {
    await cdp.send('Runtime.evaluate', { expression: injectSrc, returnByValue: true });
  } catch { /* 页面未就绪时由新文档注入兜底 */ }
  log('已注入:', t.url || t.type);
  return cdp;
}

// ---------- run 模式: 启动应用并持续注入 ----------
async function doRun() {
  let dict = {};
  if (existsSync(DICT_FILE)) {
    dict = JSON.parse(readFileSync(DICT_FILE, 'utf8'));
    log(`词典已加载: ${Object.keys(dict).length} 条 (${DICT_FILE})`);
  } else {
    log(`警告: 未找到词典 ${DICT_FILE}, 将以英文界面启动。`);
  }
  const injectSrc = buildInjectSource(dict);

  const already = isAppRunning();
  let child = null;
  if (already) {
    log('Cline 已在运行, 尝试直连调试端口(若非带端口启动会失败)。');
  } else {
    log('启动 Cline (调试端口 ' + PORT + ') ...');
    child = spawnApp();
  }
  if (!(await waitForDevtools(already ? 6000 : 45000))) {
    log('无法连接调试端口。若 Cline 已在运行, 请先完全退出 (node cline-zh.mjs kill) 再试。');
    process.exit(1);
  }

  const attached = new Map();
  const attachAll = async () => {
    let pages;
    try { pages = await listPageTargets(); } catch { return true; }
    for (const t of pages) {
      if (attached.has(t.id)) continue;
      try {
        const cdp = await attachAndInject(t, injectSrc);
        if (cdp) attached.set(t.id, cdp);
      } catch (e) {
        log('注入失败:', t.url || t.type, e.message);
      }
    }
    return false;
  };

  await attachAll();
  log('汉化已生效。保持本窗口运行; 关闭 Cline 后本工具自动退出。');

  let exited = false;
  if (child) child.on('exit', () => { exited = true; });
  while (!exited) {
    await sleep(2000);
    if (child && child.exitCode !== null) break;
    const gone = await attachAll();
    if (gone && !child) break;
  }
  log('Cline 已退出, 汉化插件结束。');
  process.exit(0);
}

// ---------- verify 模式 ----------
async function doVerify() {
  const pages = await listPageTargets();
  if (!pages.length) { log('未发现页面目标, 应用可能未运行。'); return; }
  for (const t of pages) {
    const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
    try {
      const expr = `(() => {
        const zh = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const v = w.currentNode.nodeValue.trim();
          if (v && /[\\u4e00-\\u9fff]/.test(v)) zh.push(v);
        }
        const d = window.__CLINE_ZH_DICT__ || {};
        return JSON.stringify({ href: location.href, plugin: !!window.__clineZh, dictSize: Object.keys(d).length, zhCount: zh.length, sample: [...new Set(zh)].slice(0, 25) });
      })()`;
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      log('目标: ' + t.url);
      log(JSON.stringify(JSON.parse(r.result.value), null, 2));
    } catch (e) {
      log('验证失败:', t.url, e.message);
    } finally {
      cdp.close();
    }
  }
}

// ---------- 入口 ----------
(async () => {
  try {
    if (mode === 'dump') await doDump();
    else if (mode === 'run') await doRun();
    else if (mode === 'verify') await doVerify();
    else if (mode === 'kill') { killApp(); log('已关闭 Cline。'); }
    else {
      console.log('用法: node cline-zh.mjs <dump|run|verify|kill> [--port 9223] [--exe 路径] [--dict zh-cn.json]');
      process.exit(1);
    }
  } catch (e) {
    log('错误:', e.message);
    process.exit(1);
  }
})();

