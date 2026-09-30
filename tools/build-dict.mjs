#!/usr/bin/env node
/**
 * build-dict.mjs —— 合并多个开源汉化项目的词典, 生成 dict/zh-cn.json
 *
 * 来源(均为开源仓库, 许可见 NOTICE.md / licenses/):
 *  1) HybridTalentComputing/cline-chinese
 *     webview-ui/src/locales/{en,zh-CN}/*.json —— 官方 webview 的 i18n 资源,
 *     按相同 key 路径配对得到 “英文原文 -> 中文译文”。
 *  2) JACK5920/cline-desktop-zh
 *     dictionary.json —— texts / attrs (精确) + textPatterns / attrPatterns (正则)。
 *  3) aaxianyu/cline-desktop-chinese
 *     zh-cn.json —— “英文原文”: “译文”, key 以 ^ 开头的为正则。
 *  4) Seventy73-oss/cline-desktop-cn
 *     dict.json (精确) + rules.json (正则对)。
 *
 * 源文件放在 vendor/ 下, 由 scripts/fetch-sources.ps1 下载:
 *   vendor/i18n/{en,zh-CN}-{common,common-misc,settings}.json
 *   vendor/jack/dictionary.json
 *   vendor/aaxianyu/zh-cn.json
 *   vendor/seventy73/{dict.json,rules.json}
 *
 * 输出: dict/zh-cn.json
 *   - 精确词条: "English text": "中文译文"
 *   - 正则词条: "^Pattern (\\d+)$": "中文 $1"   (key 以 ^ 开头即为正则源)
 *   - 不区分大小写: "(?i)^Pattern$": "中文"    (少数来源带 i 标记)
 *
 * 优先级(后者覆盖前者): 官方 i18n < JACK5920 < aaxianyu < Seventy73 < dict/overrides.json(本地覆盖)
 * 用法: powershell -File scripts/fetch-sources.ps1  然后 node tools/build-dict.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = join(ROOT, 'vendor');
const OUT_DIR = join(ROOT, 'dict');
const OUT_FILE = join(OUT_DIR, 'zh-cn.json');
const STATS_FILE = join(OUT_DIR, 'build-stats.txt');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else if (typeof v === 'string') out[path] = v;
  }
  return out;
}

// ---------- 词条合法性 ----------
const BLOCK = /^(https?:|www\.|\/|\.|\d+$|\{\{|<%|<\w+>|#)/i;
function acceptable(key, val) {
  if (!key || !val) return false;
  if (key.length < 1 || key.length > 300) return false;
  if (val === key) return false;
  if (!/[A-Za-z]{2}/.test(key)) return false;      // 原文必须含英文单词
  if (!/[\u4e00-\u9fff]/.test(val)) return false;  // 译文必须含中文
  if (BLOCK.test(key)) return false;
  if (/{{|}}|%\d|\$\{/.test(key)) return false;    // 模板占位符
  return true;
}

const conflicts = new Map();  // 原文 -> Set(来源)
const merged = {};
const origin = {};

// ---------- 1) 官方 i18n en/zh-CN 配对 ----------
function loadOfficialI18n() {
  const dir = join(REF, 'i18n');
  const out = {};
  let pairs = 0;
  for (const mod of ['common', 'common-misc', 'settings']) {
    const enPath = join(dir, `en-${mod}.json`);
    const zhPath = join(dir, `zh-CN-${mod}.json`);
    if (!existsSync(enPath) || !existsSync(zhPath)) continue;
    const en = flatten(readJson(enPath));
    const zh = flatten(readJson(zhPath));
    for (const [p, enText] of Object.entries(en)) {
      const zhText = zh[p];
      if (typeof zhText === 'string' && zhText && zhText !== enText) {
        if (out[enText] === undefined) out[enText] = zhText;
        pairs++;
      }
    }
  }
  return { entries: out, pairs };
}

// ---------- 2) JACK5920/cline-desktop-zh ----------
function loadJackDictionary() {
  const p = join(REF, 'jack', 'dictionary.json');
  if (!existsSync(p)) return {};
  const d = readJson(p);
  const out = {};
  for (const [k, v] of Object.entries(d.texts || {})) out[k] = v;
  for (const [k, v] of Object.entries(d.attrs || {})) out[k] = v;
  for (const [k, v] of Object.entries(d.wholeElements || {})) out[k] = v;
  for (const [pattern, rep, flags] of d.textPatterns || []) {
    let p2 = String(pattern);
    if (!p2.startsWith('^')) p2 = '^' + p2;
    if (!p2.endsWith('$')) p2 = p2 + '$';
    out[(/i/i.test(flags || '') ? '(?i)' : '') + p2] = rep;
  }
  for (const [pattern, rep, flags] of d.attrPatterns || []) {
    let p2 = String(pattern);
    if (!p2.startsWith('^')) p2 = '^' + p2;
    if (!p2.endsWith('$')) p2 = p2 + '$';
    out[(/i/i.test(flags || '') ? '(?i)' : '') + p2] = rep;
  }
  return out;
}

// ---------- 3) aaxianyu/cline-desktop-chinese ----------
function loadAaXianYu() {
  const p = join(REF, 'aaxianyu', 'zh-cn.json');
  if (!existsSync(p)) return {};
  const out = {};
  for (const [k, v] of Object.entries(readJson(p))) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ---------- 4) Seventy73-oss/cline-desktop-cn ----------
function loadSeventy73() {
  const dir = join(REF, 'seventy73');
  const out = {};
  const dictPath = join(dir, 'dict.json');
  if (existsSync(dictPath)) {
    for (const [k, v] of Object.entries(readJson(dictPath))) out[k] = v;
  }
  const rulesPath = join(dir, 'rules.json');
  if (existsSync(rulesPath)) {
    for (const [pattern, rep] of readJson(rulesPath)) {
      let p2 = String(pattern);
      if (!p2.startsWith('^')) p2 = '^' + p2;
      if (!p2.endsWith('$')) p2 = p2 + '$';
      out[p2] = rep;
    }
  }
  return out;
}

// ---------- 合并(后者覆盖前者) ----------
function mergeAll(entries, name) {
  let n = 0;
  for (const [rawKey, v] of Object.entries(entries)) {
    const k = String(rawKey).trim();   // 去掉首尾空白: 翻译脚本按 trim 后的文本匹配
    if (!acceptable(k, v)) continue;
    if (k.startsWith('^') || k.startsWith('(?i)')) {
      const src = k.startsWith('(?i)') ? k.slice(4) : k;
      try { new RegExp(src, k.startsWith('(?i)') ? 'i' : ''); } catch { continue; }
    }
    if (merged[k] !== undefined && merged[k] !== v) {
      if (!conflicts.has(k)) conflicts.set(k, new Set([origin[k]]));
      conflicts.get(k).add(name);
    }
    merged[k] = v;
    origin[k] = name;
    n++;
  }
  return n;
}

// ---------- 5) 本地覆盖（dict/overrides.json，优先级最高） ----------
function loadOverrides() {
  const p = join(OUT_DIR, 'overrides.json');
  if (!existsSync(p)) return {};
  const out = {};
  for (const [k, v] of Object.entries(readJson(p))) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

const official = loadOfficialI18n();
const missing = [];
if (!official.pairs) missing.push('vendor/i18n（官方 i18n 资源）');
for (const [name, loader, file] of [
  ['JACK5920', loadJackDictionary, 'vendor/jack/dictionary.json'],
  ['aaxianyu', loadAaXianYu, 'vendor/aaxianyu/zh-cn.json'],
  ['Seventy73', loadSeventy73, 'vendor/seventy73/{dict.json,rules.json}'],
]) {
  const data = loader();
  if (!Object.keys(data).length) missing.push(`${file}（${name}）`);
}
if (missing.length) {
  console.log('⚠ 以下词典来源缺失，已跳过：');
  for (const m of missing) console.log('  - ' + m);
  console.log('  提示: 先运行  powershell -File scripts/fetch-sources.ps1  下载来源。\n');
}

const counts = {
  '官方 i18n (配对)': mergeAll(official.entries, '官方 i18n'),
  'JACK5920/cline-desktop-zh': mergeAll(loadJackDictionary(), 'JACK5920'),
  'aaxianyu/cline-desktop-chinese': mergeAll(loadAaXianYu(), 'aaxianyu'),
  'Seventy73-oss/cline-desktop-cn': mergeAll(loadSeventy73(), 'Seventy73'),
  '本地覆盖 (dict/overrides.json)': mergeAll(loadOverrides(), '本地覆盖'),
};

// 安全阀: 词条过少说明来源缺失或解析出错, 拒绝覆盖已有词典, 避免把词典写坏
const totalMerged = Object.keys(merged).length;
if (totalMerged < 500) {
  console.error(`✘ 合并结果仅 ${totalMerged} 条（< 500），疑似来源缺失，已中止，未覆盖 dict/zh-cn.json。`);
  console.error('  请先运行: powershell -File scripts/fetch-sources.ps1');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const sorted = {};
for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');

const total = Object.keys(sorted).length;
const exact = Object.keys(sorted).filter((k) => !k.startsWith('^') && !k.startsWith('(?i)')).length;
const lines = [
  `生成时间: ${new Date().toISOString()}`,
  `输出: ${OUT_FILE}`,
  '',
  '各来源有效词条数(合并前):',
  ...Object.entries(counts).map(([k, v]) => `  - ${k}: ${v}`),
  `官方 i18n 配对成功: ${official.pairs}`,
  '',
  `合并后词条总数: ${total}`,
  `  精确词条: ${exact}`,
  `  正则词条: ${total - exact}`,
  `同一原文存在不同译文的词条数: ${conflicts.size}`,
  '',
  '冲突示例(前 20 条; 最终取值优先级 本地覆盖 > Seventy73 > aaxianyu > JACK5920 > 官方 i18n):',
  ...[...conflicts.entries()].slice(0, 20).map(([k, v]) => `  "${k}" <- ${[...v].join(', ')}`),
];
writeFileSync(STATS_FILE, lines.join('\n') + '\n', 'utf8');
console.log(lines.join('\n'));

