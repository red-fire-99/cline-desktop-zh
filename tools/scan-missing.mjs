/**
 * 未汉化检测：扫出界面上仍是英文、且不属于代码/专有名词的文案，列为词典候选。
 *
 * 背景：Cline 的运行时错误（如 OpenRouter 返回的 429 详情）不在前端静态资源里，
 * 「扫描前端资源补词典」的流程天然覆盖不到，只能靠用户遇到后再补。
 * 这个工具把「用户遇到 → 截图反馈」变成「跑一次命令 → 拿到候选清单」。
 *
 * 用法：
 *   node tools\scan-missing.mjs            # 扫描并打印候选
 *   node tools\scan-missing.mjs --write    # 追加到 dict\missed.json（人工翻译后再并入）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PORT = Number(process.env.ZH_PORT || 9223);

// ---------- 1. 连接 CDP ----------
async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const pages = (await res.json()).filter((x) => x.type === 'page');
  if (!pages.length) throw new Error('没有可调试页面：请用「Cline 中文版」快捷方式启动 Cline');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  return ws;
}

// ---------- 2. 页内扫描 ----------
// 判定「疑似漏翻」的条件：
//  - 文本里有一定比例的英文单词（排除纯 URL、纯代码标识符、纯数字）
//  - 位于翻译器不会跳过的区域（不在 code/pre/textarea/script 内）
//  - 没有 data-zh-out（说明翻译器碰过它，但没能翻）
const SCAN = `(() => {
  const SKIP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, CODE:1, PRE:1, KBD:1 };
  const inSkip = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (SKIP[n.tagName]) return true; return false; };
  const out = [];
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const el = n.parentElement;
    if (!el || inSkip(el)) continue;
    const t = (n.nodeValue || '').trim();
    if (t.length < 4 || t.length > 600) continue;
    if (seen.has(t)) continue;
    // 英文单词占比
    const words = t.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    if (words.length < 2) continue;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters / t.length < 0.3) continue;
    // 纯代码/标识符特征：大量符号、驼峰+下划线、路径
    if (/[{};=<>|\\\\]|^https?:\\/\\//.test(t)) continue;
    seen.add(t);
    out.push({ text: t, tag: (el.tagName||'').toLowerCase(), zhOut: el.getAttribute('data-zh-out') });
    if (out.length >= 300) break;
  }
  return JSON.stringify(out);
})()`;

function isProperNounish(text) {
  // 明显是专有名词 / 产品名 / 模型名的，整条跳过，不当候选
  const proper = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || [];
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return proper.length > 0 && proper.length / words.length > 0.5;
}

function loadDict() {
  const zh = JSON.parse(readFileSync(resolve(REPO, 'dict/zh-cn.json'), 'utf8'));
  const fr = JSON.parse(readFileSync(resolve(REPO, 'dict/fragments.json'), 'utf8'));
  return { zh, fr };
}

function covered(text, { zh, fr }) {
  if (Object.prototype.hasOwnProperty.call(zh, text)) return true;
  const keys = Object.keys(fr);
  return keys.some((k) => text.includes(k));
}

// ---------- 3. 主流程 ----------
const ws = await connect();
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});

const r = await send('Runtime.evaluate', { expression: SCAN, returnByValue: true });
ws.close();

const raw = r.result?.value;
if (!raw) { console.error('扫描失败：页面未返回结果'); process.exit(1); }
const items = JSON.parse(raw);
const { zh, fr } = loadDict();

const candidates = [];
for (const it of items) {
  if (looksLikeNoise(it.text)) continue;
  if (isProperNounish(it.text)) continue;
  if (covered(it.text, { zh, fr })) continue;
  candidates.push(it);
}

// 去重并按长度排序（长的通常是错误详情，信息量更大）
const uniq = new Map();
for (const c of candidates) if (!uniq.has(c.text)) uniq.set(c.text, c);
const list = [...uniq.values()].sort((a, b) => b.text.length - a.text.length);

console.log('=== 未汉化候选（' + list.length + ' 条）===');
if (!list.length) { console.log('（无）'); process.exit(0); }
for (const c of list) {
  console.log('\n[' + c.tag + (c.zhOut ? ' 有译文记录' : '') + ']');
  console.log(c.text.length > 300 ? c.text.slice(0, 300) + ' ...' : c.text);
}

if (process.argv.includes('--write')) {
  const out = resolve(REPO, 'dict/missed.json');
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  let n = 0;
  for (const c of list) if (!(c.text in prev)) { prev[c.text] = ''; n++; }
  writeFileSync(out, JSON.stringify(prev, null, 2) + '\n', 'utf8');
  console.log('\n已追加 ' + n + ' 条待译项到 dict/missed.json（值为空，需人工填写译文）');
}

/**
 * 明显的非 UI 文案：域名、URL、中文句子里的专有名词片段、代码标识符等。
 * 页面上还混着会话内容（用户消息、工具输出），这些本来就不该翻。
 */
function looksLikeNoise(text) {
  // 纯域名 / URL / 路径
  if (/^[\w.-]+\.(com|gov|cn|org|net|io|ai|dev|edu)\b/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  // 已含中文 -> 多半是已汉化文案里保留的专有名词，或用户自己的消息
  if (/[\u4e00-\u9fa5]/.test(text)) return true;
  // 含大量点分隔的标识符（czj.bengbu.gov.cn）
  if (/([A-Za-z0-9-]+\.){2,}/.test(text)) return true;
  // 带 Windows 路径 / 可执行文件 / 命令行
  if (/[A-Z]:\\|\.(ps1|mjs|js|json|exe|py|ts|md)\b/i.test(text)) return true;
  // 纯数字/版本号/单位混排（750ms -> 12ms、2.4.1 之类），没有成句的英文
  if (!/[a-z]{4}/i.test(text)) return true;

  // 以下按「单词形态」判断是产品名/标识符还是真正的句子。
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  // 连词/介词等常见小写虚词数量：句子必然含有，虚词少的更像专有名词
  const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'no', 'if', 'then', 'than', 'that', 'this', 'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'may', 'must', 'should', 'do', 'does', 'did', 'please', 'try', 'again', 'before', 'after', 'while', 'when', 'where', 'which', 'who', 'you', 'your', 'my', 'we', 'they']);
  const lower = words.map((w) => w.toLowerCase());
  const funcCount = lower.filter((w) => FUNCTION_WORDS.has(w)).length;

  // 连字符大写标识符：X-RateLimit-Remaining
  if (/^[A-Z][A-Za-z]*(-[A-Za-z]+){1,}$/.test(text)) return true;

  // 无虚词的短文本 -> 产品名 / 账号名 / 服务商名（Cline Usage-Billing、Google AI Studio）
  if (funcCount === 0 && words.length <= 5 && text.length < 40) return true;

  // 形如 "Model Name (free)"：括号里是计费标记
  if (/^[A-Za-z][\w .-]*\((free|beta|preview|pro)\)$/i.test(text)) return true;

  return false;
}

