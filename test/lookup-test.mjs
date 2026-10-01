// lookup-test.mjs —— 词典查找逻辑单元测试（无需浏览器）
// 说明: 这里复刻 tools/translator.js 的查找顺序 —— 先精确匹配，再正则（按词典 key 的插入顺序）。
// 若两处逻辑出现分歧，以 translator.js 为准并同步本文件。
const fs = await import('node:fs');
const path = await import('node:path');

const dictPath = path.join(import.meta.dirname, '..', 'dict', 'zh-cn.json');
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));

// 与 translator.js 的 getRegexes() 保持一致：(?i) 前缀 → 忽略大小写；^ 开头 → 普通正则
const regexes = [];
for (const k of Object.keys(dict)) {
  try {
    if (k.slice(0, 4) === '(?i)') regexes.push([new RegExp(k.slice(4), 'i'), dict[k]]);
    else if (k.charAt(0) === '^') regexes.push([new RegExp(k), dict[k]]);
  } catch { /* 忽略非法正则 */ }
}

// 片段级替换：整条没命中时，对文本中的片段逐一替换（长片段优先）
const fragPath = path.join(import.meta.dirname, '..', 'dict', 'fragments.json');
const frags = fs.existsSync(fragPath) ? JSON.parse(fs.readFileSync(fragPath, 'utf8')) : {};
const fragKeys = Object.keys(frags).filter((k) => k && frags[k]).sort((a, b) => b.length - a.length);
function applyFragments(text) {
  if (!fragKeys.length || text.length < 12) return null;
  let out = text, hit = false;
  for (const k of fragKeys) {
    if (out.includes(k)) { out = out.split(k).join(frags[k]); hit = true; }
  }
  return hit ? out : null;
}

function lookup(text) {
  let t = dict[text];
  if (t !== undefined) return t;
  const collapsed = text.replace(/\s+/g, ' ');
  if (collapsed !== text && dict[collapsed] !== undefined) return dict[collapsed];
  for (const [re, rep] of regexes) {
    const m = text.match(re);
    if (m) return rep.replace(/\$(\d)/g, (_, g) => (m[+g] !== undefined ? m[+g] : ''));
  }
  return applyFragments(text);   // 整条未命中 -> 片段替换
}

const jsonDaily = 'The run failed: {"error":{"code":"INFERENCE_CAP_ERROR","message":"Error 429: Daily free limit reached on model deepseek/deepseek-v4.1-flash. Try again in 23h 50m"}}';

const cases = [
  // 运行时错误：整条规则命中（JSON 额度耗尽）
  [jsonDaily,
    '运行失败：{"error":{"code":"INFERENCE_CAP_ERROR","message":"模型 deepseek/deepseek-v4.1-flash 的每日免费额度已用尽，请在 23h 50m 后重试"}}'],
  // 运行时错误：余额不足（金额可变）
  ['The run failed: Insufficient balance. Your Cline Credits balance is $0.01',
    '运行失败：余额不足。你的 Cline Credits 余额为 $0.01'],
  ['The run failed: JSON error injected into SSE stream', '运行失败：SSE 流中出现 JSON 错误'],
  // 兜底规则：其余未知错误保留原文细节
  ['The run failed: rate limit exceeded, retry in 30s', '运行失败：rate limit exceeded, retry in 30s'],
  // 片段替换：未知结构但含已知错误短语
  ['Provider error: Rate limit exceeded, please retry later', 'Provider error: 超出速率限制, please retry later'],
  // 已有词条回归
  ['Settings', '设置'],
  ['Read 7 files', '读取 7 个文件'],
  ['3 configured · 12 available', '3 个已配置 · 12 个可用'],
  // 不该被翻译的
  ['Some random chat text', null],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = lookup(input);
  const pass = got === want;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${JSON.stringify(input).slice(0, 78)}  =>  ${JSON.stringify(got).slice(0, 96)}` +
    (pass ? '' : `\n      期望: ${JSON.stringify(want)}`));
}

// 关键回归: 具体规则必须排在兜底规则之前（词典对正则按长度降序排序）
const catchAllKey = '^The run failed:\\s*(.+)$';
const specificKeys = [
  '^The run failed: Insufficient balance\\. Your Cline Credits balance is \\$([0-9.]+)$',
  '^The run failed: \\{"error":\\{"code":"([^"]*)","message":"Error 429: Daily free limit reached on model ([^"]*?)\\. Try again in ([^"]*?)"\\}\\}$',
];
const keys = Object.keys(dict);
const iCatchAll = keys.indexOf(catchAllKey);
let orderOk = iCatchAll > 0;
console.log(`\n顺序检查: 兜底规则@${iCatchAll}`);
for (const k of specificKeys) {
  const i = keys.indexOf(k);
  const ok = i >= 0 && i < iCatchAll;
  if (!ok) orderOk = false;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} 具体规则@${i}  ${k.slice(0, 62)}…`);
}
console.log(`片段词典: ${fragKeys.length} 条`);

console.log(`\n词条总数 ${keys.length}，测试 ${cases.length} 条`);
if (failed || !orderOk) {
  console.error(`✘ 失败 ${failed} 条${orderOk ? '' : '，且顺序检查未通过'}`);
  process.exit(1);
}
console.log('✔ 全部通过');
