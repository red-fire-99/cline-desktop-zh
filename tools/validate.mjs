#!/usr/bin/env node
/**
 * validate.mjs —— 仓库自检（CI 与本地均可用，不需要 Cline 运行）
 *  1) dict/zh-cn.json 可解析、词条数量合理、key/value 合法、正则词条可编译
 *  2) 所有 tools/*.mjs 通过 node --check 语法检查
 *  3) config.json / 关键文件存在
 * 用法: node tools/validate.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const ok = (msg) => console.log('  ✔ ' + msg);

// ---------- 1) 词典 ----------
const dictPath = join(ROOT, 'dict', 'zh-cn.json');
if (!existsSync(dictPath)) {
  errors.push('缺少 dict/zh-cn.json');
} else {
  let dict;
  try {
    dict = JSON.parse(readFileSync(dictPath, 'utf8'));
    ok(`dict/zh-cn.json 解析成功，共 ${Object.keys(dict).length} 条`);
  } catch (e) {
    errors.push('dict/zh-cn.json 无法解析: ' + e.message);
  }
  if (dict) {
    const keys = Object.keys(dict);
    if (keys.length < 500) errors.push(`词条数量异常偏少(${keys.length})，疑似词典损坏或未合并成功`);
    let exact = 0, regex = 0;
    for (const k of keys) {
      const v = dict[k];
      if (typeof v !== 'string' || !v) { errors.push(`词条值为空: ${JSON.stringify(k)}`); continue; }
      const isRe = k.startsWith('^') || k.startsWith('(?i)');
      if (isRe) {
        regex++;
        const src = k.startsWith('(?i)') ? k.slice(4) : k;
        try { new RegExp(src, k.startsWith('(?i)') ? 'i' : ''); }
        catch (e) { errors.push(`正则词条无法编译: ${JSON.stringify(k)} (${e.message})`); }
      } else {
        exact++;
        if (/[\u4e00-\u9fff]/.test(k)) warnings.push(`英文原文里含中文，可能无效: ${JSON.stringify(k)}`);
        if (k !== k.trim()) warnings.push(`原文含首尾空白: ${JSON.stringify(k)}`);
      }
      if (!/[\u4e00-\u9fff]/.test(v)) warnings.push(`译文不含中文: ${JSON.stringify(k)} => ${JSON.stringify(v)}`);
    }
    ok(`精确词条 ${exact} 条 / 正则词条 ${regex} 条`);
  }
}

// ---------- 2) 脚本语法 ----------
const toolsDir = join(ROOT, 'tools');
for (const f of readdirSync(toolsDir).filter((x) => x.endsWith('.mjs'))) {
  try {
    execFileSync(process.execPath, ['--check', join(toolsDir, f)], { stdio: 'pipe' });
    ok(`tools/${f} 语法检查通过`);
  } catch (e) {
    errors.push(`tools/${f} 语法错误: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}

// ---------- 3) 关键文件 ----------
for (const f of ['config.json', 'CONTRIBUTING.md', 'launcher/cline-zh.vbs', 'scripts/setup.ps1', 'tools/translator.js', 'tools/cline-zh.mjs']) {
  if (existsSync(join(ROOT, f))) ok(`存在 ${f}`);
  else errors.push(`缺少文件: ${f}`);
}

// ---------- 4) PowerShell 脚本 lint ----------
// PowerShell 会把印刷引号 “ ” 当成字符串定界符 —— 一旦出现在双引号字符串里就会解析失败，
// 因此仓库内 .ps1 一律禁止使用 “ ”，中文引号请用 「」 或单引号字符串。
for (const dir of ['scripts', 'test']) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.ps1'))) {
    const text = readFileSync(join(d, f), 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      // 只有“双引号字符串里出现印刷引号”才会导致解析失败；单引号字符串里是安全的
      if (/[\u201C\u201D]/.test(line) && line.includes('"')) {
        errors.push(`${dir}/${f}:${i + 1} 在双引号字符串里使用了印刷引号 “ ”（PowerShell 会当作字符串定界符），请改用 「」 或单引号字符串`);
      }
    });
  }
}
ok('PowerShell 脚本引号 lint 通过');

// ---------- 汇总 ----------
console.log('');
if (warnings.length) {
  console.log(`⚠ ${warnings.length} 条警告：`);
  for (const w of warnings.slice(0, 15)) console.log('  - ' + w);
  if (warnings.length > 15) console.log(`  ... 其余 ${warnings.length - 15} 条省略`);
  console.log('');
}
if (errors.length) {
  console.error(`✘ 自检未通过，共 ${errors.length} 个错误：`);
  for (const e of errors.slice(0, 30)) console.error('  - ' + e);
  process.exit(1);
}
console.log('✔ 自检全部通过');
