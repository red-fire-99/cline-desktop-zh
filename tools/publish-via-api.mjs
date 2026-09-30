#!/usr/bin/env node
/**
 * publish-via-api.mjs —— 通过 GitHub API 发布（绕过 github.com 的 git 通道）
 *
 * 适用场景: github.com:443 连不通（网络受限），但 api.github.com 可用时。
 * 原理: 用 Git Data API 创建 blob / tree / commit，最后创建分支引用。
 *       对象内容与本地 git 对象完全一致，因此生成的 commit SHA 与本地 HEAD 相同，
 *       将来网络恢复后可以正常 git fetch / git pull / git push。
 *
 * 用法:
 *   $env:GITHUB_TOKEN = 'ghp_xxx'
 *   node tools\publish-via-api.mjs --repo your-github-user/cline-desktop-zh [--dry-run]
 *
 * 注意: token 只从环境变量读取，不会写入任何文件或 git 配置。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = argv.includes('--dry-run');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('缺少环境变量 GITHUB_TOKEN'); process.exit(1); }
const repoSpec = opt('repo', '');
if (!/^[\w.-]+\/[\w.-]+$/.test(repoSpec)) { console.error('请用 --repo 所有者/仓库名 形式指定仓库'); process.exit(1); }
const [owner, repo] = repoSpec.split('/');
const API = `https://api.github.com/repos/${owner}/${repo}`;
const HEADERS = {
  'User-Agent': 'cline-desktop-zh-publish',
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const GIT_EXE = [
  process.env.GIT_EXE,
  join(process.env.USERPROFILE || '', 'dev-tools', 'mingit', 'cmd', 'git.exe'),
  'git',
].filter(Boolean).find((p) => p === 'git' || existsSync(p)) || 'git';

const git = (...args) => execFileSync(GIT_EXE, ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

async function api(method, url, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      body: body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined,
    });
    if (res.ok || res.status === 409 || res.status === 422) return { status: res.status, data: await res.json().catch(() => ({})) };
    if (res.status >= 500 && attempt < 4) { await new Promise((r) => setTimeout(r, attempt * 800)); continue; }
    throw new Error(`${method} ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

// ---------- 读取本地 git 对象（按原始 commit 对象精确复刻，保证 SHA 一致） ----------
const branch = opt('branch', 'main');
const commitShas = git('log', '--reverse', '--pretty=%H', branch).split('\n').filter(Boolean);

function gitDateToIso(ts, tz) {
  const sign = tz[0] === '-' ? -1 : 1;
  const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const iso = new Date((Number(ts) + offMin * 60) * 1000).toISOString().replace('Z', '');
  const tzs = (offMin >= 0 ? '+' : '-') +
    String(Math.floor(Math.abs(offMin) / 60)).padStart(2, '0') + ':' +
    String(Math.abs(offMin) % 60).padStart(2, '0');
  return iso.slice(0, 19) + tzs;
}

function parseIdent(s) {
  const m = s.match(/^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/);
  if (!m) throw new Error('无法解析 git 身份行: ' + s);
  return { name: m[1], email: m[2], date: gitDateToIso(m[3], m[4]) };
}

function parseCommit(sha) {
  const raw = execFileSync(GIT_EXE, ['-C', ROOT, 'cat-file', 'commit', sha], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const sep = raw.indexOf('\n\n');
  const out = { message: raw.slice(sep + 2), parents: [] };
  for (const line of raw.slice(0, sep).split('\n')) {
    if (line.startsWith('tree ')) out.tree = line.slice(5).trim();
    else if (line.startsWith('parent ')) out.parents.push(line.slice(7).trim());
    else if (line.startsWith('author ')) out.author = parseIdent(line.slice(7));
    else if (line.startsWith('committer ')) out.committer = parseIdent(line.slice(10));
  }
  return out;
}

const commits = commitShas.map((sha) => ({ sha, ...parseCommit(sha) }));

console.log(`仓库: ${owner}/${repo}`);
console.log(`分支: ${branch}   提交数: ${commits.length}   git: ${GIT_EXE}`);
if (DRY) console.log('dry-run: 只列出计划，不调用 API');

// ---------- 1) 上传所有 blob（按内容去重） ----------
const blobCache = new Map();
for (const c of commits) {
  for (const e of git('ls-tree', '-r', c.sha).split('\n').filter(Boolean)) {
    const m = e.match(/^\d+ blob ([0-9a-f]{40})\t/);
    if (m && !blobCache.has(m[1])) blobCache.set(m[1], null);
  }
}
const total = blobCache.size;
console.log(`需要上传的 blob: ${total} 个`);

let uploaded = 0;
const queue = [...blobCache.keys()];
async function worker() {
  while (queue.length) {
    const blobSha = queue.shift();
    if (DRY) { blobCache.set(blobSha, blobSha); continue; }
    const content = execFileSync(GIT_EXE, ['-C', ROOT, 'cat-file', 'blob', blobSha], { maxBuffer: 64 * 1024 * 1024 });
    const r = await api('POST', `${API}/git/blobs`, { content: content.toString('base64'), encoding: 'base64' });
    if (r.data.sha !== blobSha) throw new Error(`blob SHA 不一致: 本地 ${blobSha} / 远端 ${r.data.sha}`);
    blobCache.set(blobSha, r.data.sha);
    uploaded++;
    if (uploaded % 25 === 0) console.log(`  blob 进度: ${uploaded}/${total}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`blob 上传完成: ${uploaded} 个`);
// ---------- 2) 逐个提交创建 tree + commit（保持与本地完全一致） ----------
let head = null;
for (const c of commits) {
  const entries = git('ls-tree', '-r', c.sha).split('\n').filter(Boolean).map((e) => {
    const m = e.match(/^(\d+) blob ([0-9a-f]{40})\t(.+)$/);
    return { path: m[3], mode: m[1], type: 'blob', sha: blobCache.get(m[2]) };
  });
  if (!DRY) {
    const localTree = git('rev-parse', `${c.sha}^{tree}`);
    const t = await api('POST', `${API}/git/trees`, { tree: entries });
    if (t.data.sha !== localTree) throw new Error(`tree SHA 不一致: 本地 ${localTree} / 远端 ${t.data.sha}`);
    const r = await api('POST', `${API}/git/commits`, {
      message: c.message, tree: t.data.sha, parents: c.parents,
      author: c.author, committer: c.committer,
    });
    if (r.data.sha !== c.sha) throw new Error(`commit SHA 不一致: 本地 ${c.sha} / 远端 ${r.data.sha}`);
  }
  head = c.sha;
  console.log(`  提交已同步: ${c.sha.slice(0, 7)}  ${c.message.split('\n')[0].slice(0, 46)}`);
}

// ---------- 3) 创建/更新分支引用 ----------
if (DRY) {
  console.log('\ndry-run 结束，未做任何修改。');
} else {
  const cur = await api('GET', `${API}/git/ref/heads/${branch}`);
  if (cur.status === 200 && cur.data.object) {
    await api('PATCH', `${API}/git/refs/heads/${branch}`, { sha: head, force: true });
    console.log(`分支 ${branch} 已更新 -> ${head}`);
  } else {
    const c = await api('POST', `${API}/git/refs`, { ref: `refs/heads/${branch}`, sha: head });
    console.log(`分支 ${branch} 已创建 -> ${c.data.object.sha}`);
  }
  const check = await api('GET', `${API}/commits/${branch}`);
  if (check.data.sha !== head) throw new Error('远端校验失败');
  console.log('\n✔ 远端校验通过，commit 与本地一致');
  console.log('  仓库: https://github.com/' + owner + '/' + repo);
}

