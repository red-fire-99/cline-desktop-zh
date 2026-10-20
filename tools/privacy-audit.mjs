#!/usr/bin/env node
/**
 * privacy-audit.mjs —— 发布前的隐私自查（只读，不修改任何东西）
 *
 * 扫描范围:
 *   1) 工作区已跟踪文件 + 待提交(untracked)文件
 *   2) 完整 git 历史（所有 commit 的所有 blob）
 *
 * 检查项: 凭据泄漏 / 本机路径与用户名 / 个人信息 / 调试残留
 *
 * 用法:
 *   node tools/privacy-audit.mjs              # 全量扫描（含历史）
 *   node tools/privacy-audit.mjs --worktree   # 只扫工作区
 *   node tools/privacy-audit.mjs --json       # 输出 JSON（供 CI 消费）
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WORKTREE_ONLY = argv.includes('--worktree');
const AS_JSON = argv.includes('--json');

const findings = [];
const add = (severity, kind, where, detail, hint) => findings.push({ severity, kind, where, detail, hint });

// ---------- 扫描规则 ----------
/* RULES-BEGIN */
const RULES = [
  {
    kind: 'GitHub 令牌',
    re: /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    hint: '立即吊销该令牌并改用 Git Credential Manager / gh auth',
    mask: (s) => s.slice(0, 8) + '…' + s.slice(-4),
  },
  {
    kind: 'AWS Access Key',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    hint: '立即在 IAM 控制台停用该密钥',
    mask: (s) => s.slice(0, 4) + '…' + s.slice(-4),
  },
  {
    kind: '私钥',
    // 故意不把完整标记写进源码：否则本文件自己就会命中扫描规则，
    // 也容易触发 GitHub 等平台的密钥扫描误报。用拼接构造。
    re: new RegExp('-----BEGIN (?:RSA |EC |OPENSSH |PGP )?' + 'PRIVATE ' + 'KEY-----', 'g'),
    hint: '从仓库与历史中彻底移除，并更换对应密钥',
    mask: () => '-----BEGIN PRIVATE KEY-----',
  },
  {
    kind: '通用 API Key',
    re: /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/g,
    hint: '吊销该密钥',
    mask: (s) => s.slice(0, 6) + '…' + s.slice(-4),
  },
  {
    kind: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    hint: '确认不是会话令牌',
    mask: (s) => s.slice(0, 10) + '…',
  },
  {
    kind: '内网地址',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    hint: '内网 IP 属于环境信息，确认是否可公开',
    mask: (s) => s,
  },
  {
    kind: '本机绝对路径',
    re: /[A-Z]:\\(?:Users|Documents and Settings)[^\s"'`,;)\]]*/g,
    hint: '改为 $env:USERPROFILE / 相对路径',
    mask: (s) => s,
  },
  {
    kind: 'macOS/Linux 家目录',
    re: /\/Users\/[A-Za-z0-9._-]+\/[^\s"'`,;)\]]*/g,
    hint: '改为 $HOME / 相对路径',
    mask: (s) => s,
  },
  {
    kind: '疑似邮箱',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    hint: '确认不是个人邮箱',
    mask: (s) => { const [u, d] = s.split('@'); return (u.slice(0, 2) + '***@' + d); },
    skip: (s) => /@(example\.(com|org|net)|users\.noreply\.github\.com|github\.com|test|localhost|invalid)$/i.test(s)
      || /^(ghp_|github|support|info|admin|noreply|contact|hello|example|your|name|user|test|ci|bot)$/i.test(s),
    // 第三方 LICENSE / NOTICE 里的版权邮箱是公开信息，不是泄漏
    // 注意 where 形如 "history:licenses/node-LICENSE.txt@abc123"，
    // 所以不能要求 "licenses" 出现在字符串开头。
    skipPath: (where) => /(^|[/\\:])licenses?[/\\]/i.test(where) || /LICENSE|NOTICE|COPYING/i.test(where),
  },
  {
    kind: '疑似手机号（中国大陆）',
    re: /\b1[3-9]\d{9}\b/g,
    hint: '确认不是真实号码',
    mask: (s) => s.slice(0, 3) + '****' + s.slice(7),
  },
  {
    kind: '身份证号',
    re: /\b\d{17}[\dXx]\b/g,
    hint: '确认不是真实证件号',
    mask: (s) => s.slice(0, 6) + '********',
  },
];
/* RULES-END */

// 明显是占位符/示例的内容，直接跳过
const PLACEHOLDER = /(xxx+|your[_-]?\w*|<[^>]*>|\$\{?\w+\}?|%\w+%|placeholder|example\.com|changeme|redacted|token_here)/i;

// 扫描器自身的源码里包含所有规则的正则字面量，会自我误报。
// 扫描 tools/privacy-audit.mjs 时先剔除「规则定义段」，只扫它真正会处理的数据。
const SELF_FILE = 'tools/privacy-audit.mjs';
const RULES_BEGIN = '/* RULES-BEGIN */';
const RULES_END = '/* RULES-END */';
function stripSelfRules(text) {
  const b = text.indexOf(RULES_BEGIN);
  const e = text.indexOf(RULES_END);
  if (b < 0 || e < 0) return text;
  return text.slice(0, b) + text.slice(e + RULES_END.length);
}

// ---------- 文本文件判定 ----------
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.exe', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4']);
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yml', '.yaml', '.ps1', '.cmd', '.bat', '.vbs', '.html', '.css', '.toml', '.ini', '.xml']);
function shouldScan(rel) {
  if (!rel) return false;
  const ext = extname(rel).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  if (SCAN_EXT.has(ext)) return true;
  return !ext;   // 无扩展名的文件（如 .gitignore）
}

function scanText(text, where) {
  if (!text || text.length > 8 * 1024 * 1024) return;
  // 扫描器自身源码里含规则正则字面量，会自我误报。
  // where 可能是 "tools/privacy-audit.mjs" 或 "history:tools/privacy-audit.mjs@abc123"
  if (/(^|:)tools\/privacy-audit\.mjs(@|$)/.test(where)) text = stripSelfRules(text);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const raw = m[0];
      if (!raw) continue;
      if (PLACEHOLDER.test(raw)) continue;
      if (rule.skip && rule.skip(raw)) continue;
      // 规则级路径排除（如第三方 LICENSE 里的版权邮箱是公开信息）
      if (rule.skipPath && rule.skipPath(where)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      add('error', rule.kind, `${where}:${line}`, rule.mask(raw), rule.hint);
    }
  }
}

// ---------- 1) 工作区 ----------
function scanWorktree() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const tracked = new Set(git(['ls-files']).split('\n').map((s) => s.trim()).filter(Boolean));
  let untracked = [];
  try {
    untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { /* ignore */ }

  for (const rel of [...tracked, ...untracked]) {
    if (!shouldScan(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > 8 * 1024 * 1024) continue;
      scanText(readFileSync(abs, 'utf8'), rel);
    } catch { /* ignore */ }
  }
  return { tracked: tracked.size, untracked: untracked.length };
}

// ---------- 2) git 历史 ----------
function scanHistory() {
  let out = '';
  try {
    out = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  } catch { return { blobs: 0 }; }

  const seen = new Set();
  const objs = out.split('\n').map((l) => l.trim()).filter(Boolean);
  // 收集需要读取的 blob（同一 sha 只读一次）
  const todo = [];
  for (const line of objs) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1);
    if (seen.has(sha)) continue;
    seen.add(sha);
    if (!shouldScan(path)) continue;
    todo.push({ sha, path });
  }
  if (!todo.length) return { blobs: 0 };

  // 一次性批量读取，避免每个 blob 起一个 git 进程（历史有上千个 blob 时会超时）
  // 注意：必须按 Buffer（字节）解析 —— 内容含中文时字节长度与字符长度不同，
  // 用字符串偏移切内容会错位，导致只读到前几个 blob。
  const shas = todo.map((t) => t.sha);
  let raw = null;
  try {
    // encoding: null 才会返回 Buffer（Node 不接受 'buffer' 这个值）
    raw = execFileSync('git', ['cat-file', '--batch'], {
      cwd: ROOT, encoding: null, windowsHide: true, maxBuffer: 256 * 1024 * 1024,
      input: shas.join('\n') + '\n',
    });
  } catch { return { blobs: 0 }; }

  // --batch 输出格式: <sha> <type> <size>\n<content>\n
  let pos = 0, blobs = 0;
  for (const t of todo) {
    const nl = raw.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = raw.slice(pos, nl).toString('utf8').split(' ');
    const size = parseInt(header[2], 10);
    if (!Number.isFinite(size)) break;
    const content = raw.slice(nl + 1, nl + 1 + size).toString('utf8');
    pos = nl + 1 + size + 1;   // 内容后还有一个换行
    if (header[1] !== 'blob') continue;
    blobs++;
    scanText(content, `history:${t.path}@${t.sha.slice(0, 8)}`);
  }
  return { blobs };
}

// ---------- 3) 提交元数据 ----------
function scanCommitMeta() {
  const raw = execFileSync('git', ['log', '--all', '--format=%H%x1f%an%x1f%ae'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const emails = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\x1f');
    const ae = parts[2];
    if (ae && !/users\.noreply\.github\.com$/.test(ae)) emails.add(ae);
  }
  for (const e of emails) {
    add('warn', '提交作者邮箱', 'git metadata', e.replace(/^(.).*(@.*)$/, '$1***$2'), '考虑改用 noreply 邮箱');
  }
  return { commits: raw.split('\n').filter((l) => l.trim()).length };
}

// ---------- 主流程 ----------
const wt = scanWorktree();
const hist = WORKTREE_ONLY ? { blobs: 0 } : scanHistory();
const meta = WORKTREE_ONLY ? { commits: 0 } : scanCommitMeta();

// 去重（同一 kind + detail 只报一次，避免历史里同一文件多次出现刷屏）
const uniq = new Map();
for (const f of findings) {
  const k = f.kind + '|' + f.detail;
  if (!uniq.has(k)) uniq.set(k, f);
}
const list = [...uniq.values()].sort((a, b) => {
  const rank = { error: 0, warn: 1, info: 2 };
  return (rank[a.severity] - rank[b.severity]) || a.kind.localeCompare(b.kind);
});

if (AS_JSON) {
  console.log(JSON.stringify({ scanned: { worktree: wt, history: hist, commits: meta }, findings: list }, null, 2));
  process.exit(list.some((f) => f.severity === 'error') ? 1 : 0);
}

console.log('=== 隐私自查报告 ===');
console.log(`工作区: ${wt.tracked} 个已跟踪文件, ${wt.untracked} 个未跟踪文件`);
console.log(`历史: ${hist.blobs} 个 blob, ${meta.commits} 个提交`);
console.log('');

if (!list.length) {
  console.log('✔ 未发现凭据、本机路径或个人信息泄漏');
  process.exit(0);
}

let errors = 0, warns = 0;
for (const f of list) {
  if (f.severity === 'error') errors++; else warns++;
  const tag = f.severity === 'error' ? '✘ 严重' : '⚠ 提示';
  console.log(`${tag} [${f.kind}] ${f.where}`);
  console.log(`     内容: ${f.detail}`);
  console.log(`     建议: ${f.hint}`);
  console.log('');
}
console.log(`共 ${list.length} 项：严重 ${errors} 项，提示 ${warns} 项`);
process.exit(errors ? 1 : 0);

