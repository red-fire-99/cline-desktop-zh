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

function lookup(text) {
  let t = dict[text];
  if (t !== undefined) return t;
  const collapsed = text.replace(/\s+/g, ' ');
  if (collapsed !== text && dict[collapsed] !== undefined) return dict[collapsed];
  for (const [re, rep] of regexes) {
    const m = text.match(re);
    if (m) return rep.replace(/\$(\d)/g, (_, g) => (m[+g] !== undefined ? m[+g] : ''));
  }
  return null;
}

const cases = [
  // 运行时错误（本次新增）
  ['The run failed: Insufficient balance. Your Cline Credits balance is $0.01',
    '运行失败：余额不足。你的 Cline Credits 余额为 $0.01'],
  ['The run failed: Insufficient balance. Your Cline Credits balance is $0.00',
    '运行失败：余额不足。你的 Cline Credits 余额为 $0.00'],
  ['The run failed: JSON error injected into SSE stream',
    '运行失败：SSE 流中出现 JSON 错误'],
  // 兜底规则：其余未知错误保留原文细节
  ['The run failed: rate limit exceeded, retry in 30s',
    '运行失败：rate limit exceeded, retry in 30s'],
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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${JSON.stringify(input)}  =>  ${JSON.stringify(got)}` +
    (pass ? '' : `\n      期望: ${JSON.stringify(want)}`));
}

// 关键回归：特定词条必须排在兜底词条之前（词典按 key ASCII 排序，正则按 key 顺序匹配）
const specificKey = '^The run failed: Insufficient balance\\. Your Cline Credits balance is \\$([0-9.]+)$';
const catchAllKey = '^The run failed:\\s*(.+)$';
const iSpecific = Object.keys(dict).indexOf(specificKey);
const iCatchAll = Object.keys(dict).indexOf(catchAllKey);
console.log(`\n顺序检查: 特定词条@${iSpecific}  兜底词条@${iCatchAll}  -> ` +
  (iSpecific >= 0 && iSpecific < iCatchAll ? '特定优先(正确)' : '顺序错误(兜底会抢先命中)'));
const orderOk = iSpecific >= 0 && iSpecific < iCatchAll;

console.log(`\n词条总数 ${Object.keys(dict).length}，测试 ${cases.length} 条`);
if (failed || !orderOk) {
  console.error(`✘ 失败 ${failed} 条${orderOk ? '' : '，且顺序检查未通过'}`);
  process.exit(1);
}
console.log('✔ 全部通过');
