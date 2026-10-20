// dict-build-test.mjs —— 词典构建幂等性与手工词条保留测试（无需浏览器）
// 覆盖:
//   1) dict/manual.json 里的手工词条必须出现在 dict/zh-cn.json 中且译文一致
//   2) 连续两次构建的输出必须完全一致（幂等）
//   3) 构建结果的 key 顺序必须稳定（精确在前、正则按长度降序）
//   4) 合并结果若缺少主词典已有词条，构建器必须拒绝覆盖并报错退出
// 依赖: vendor/ 下的来源词典（由 scripts/fetch-sources.ps1 下载）。缺失时跳过并提示。
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const mainDictPath = join(ROOT, 'dict', 'zh-cn.json');
const manualPath = join(ROOT, 'dict', 'manual.json');
const overridesPath = join(ROOT, 'dict', 'overrides.json');
const buildScript = join(ROOT, 'tools', 'build-dict.mjs');

let failed = 0;
const check = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---------- 0) 前置条件 ----------
const hasVendor = existsSync(join(ROOT, 'vendor', 'jack', 'dictionary.json'));
if (!hasVendor) {
  console.log('⚠ 缺少 vendor/ 来源词典，跳过构建类测试。');
  console.log('  先运行: powershell -File scripts/fetch-sources.ps1');
  process.exit(0);
}

const mainDict = readJson(mainDictPath);
const mainKeys = Object.keys(mainDict);

// ---------- 1) 手工词条保留 ----------
const manual = existsSync(manualPath) ? readJson(manualPath) : {};
const manualKeys = Object.keys(manual);
check('dict/manual.json 存在且非空', manualKeys.length > 0, `${manualKeys.length} 条`);
for (const k of manualKeys) {
  if (!(k in mainDict)) {
    check(`手工词条保留: ${JSON.stringify(k).slice(0, 60)}`, false, '主词典中缺失');
    continue;
  }
  if (mainDict[k] !== manual[k]) {
    check(`手工词条保留: ${JSON.stringify(k).slice(0, 60)}`, false,
      `译文不一致: ${JSON.stringify(mainDict[k])} != ${JSON.stringify(manual[k])}`);
  }
}
if (failed === 0) check(`全部 ${manualKeys.length} 条手工词条保留在主词典中`, true);

// ---------- 2) 覆盖优先级: overrides.json 高于 manual.json ----------
if (existsSync(overridesPath)) {
  const overrides = readJson(overridesPath);
  const shared = Object.keys(overrides).filter((k) => k in manual);
  let prioOk = true;
  for (const k of shared) {
    if (mainDict[k] !== overrides[k]) { prioOk = false; console.log(`      冲突: ${JSON.stringify(k)}`); }
  }
  check(`overrides.json 优先级高于 manual.json (${shared.length} 条同 key)`, prioOk);
}

// ---------- 3) 构建幂等性 ----------
const tmp = join(ROOT, 'dict', '.build-test-tmp.json');
const run = (out) => execFileSync(node, [buildScript, '--out', out], { encoding: 'utf8', stdio: 'pipe' });
let built1 = null, built2 = null;
try {
  run(tmp);
  built1 = readFileSync(tmp, 'utf8');
  run(tmp);
  built2 = readFileSync(tmp, 'utf8');
} catch (e) {
  console.log('  构建失败: ' + String(e.stdout || e.message).split('\n').slice(0, 6).join('\n'));
}
if (built1 !== null) {
  check('连续两次构建输出完全一致（幂等）', built1 === built2);
  const parsed = JSON.parse(built1);
  check('构建结果词条数与主词典一致', Object.keys(parsed).length === mainKeys.length,
    `${Object.keys(parsed).length} vs ${mainKeys.length}`);
  check('构建结果内容与主词典一致', JSON.stringify(parsed) === JSON.stringify(mainDict));

  // ---------- 4) key 顺序稳定 ----------
  const isRe = (k) => k.startsWith('^') || k.startsWith('(?i)');
  const expected = [...mainKeys].sort((a, b) => {
    const ra = isRe(a), rb = isRe(b);
    if (ra !== rb) return ra ? 1 : -1;
    if (ra) return (b.length - a.length) || a.localeCompare(b);
    return a.localeCompare(b);
  });
  check('主词典 key 顺序符合排序规则', JSON.stringify(mainKeys) === JSON.stringify(expected));
  check('构建结果 key 顺序稳定', JSON.stringify(Object.keys(parsed)) === JSON.stringify(expected));
} else {
  check('构建成功', false);
}
rmSync(tmp, { force: true });
rmSync(tmp + '.stats.txt', { force: true });

// ---------- 5) 安全阀: 合并结果缺词条时必须拒绝覆盖 ----------
// 造一份「缺词条」的主词典副本 + 一个缺来源的 vendor 环境，
// 验证构建器退出码非 0 且不覆盖主词典。
{
  const bak = mainDictPath + '.bak-test';
  const orig = readFileSync(mainDictPath, 'utf8');
  try {
    const tampered = { ...mainDict, '__cline_zh_manual_probe__': '手工词条探测' };
    writeFileSync(bak, orig, 'utf8');
    writeFileSync(mainDictPath, JSON.stringify(tampered, null, 2) + '\n', 'utf8');
    let code = 0, msg = '';
    try {
      execFileSync(node, [buildScript], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      code = e.status ?? 1;
      msg = String(e.stdout || '') + String(e.stderr || '');
    }
    check('安全阀: 合并缺词条时构建器非 0 退出', code !== 0, `exit=${code}`);
    check('安全阀: 报错信息提示补入 dict/manual.json', /manual\.json/.test(msg));
    const after = readFileSync(mainDictPath, 'utf8');
    check('安全阀: 未覆盖被篡改的主词典', after === JSON.stringify(tampered, null, 2) + '\n');
  } finally {
    writeFileSync(mainDictPath, orig, 'utf8');
    rmSync(bak, { force: true });
  }
}

console.log(`\n主词典 ${mainKeys.length} 条，手工词条 ${manualKeys.length} 条`);
if (failed) {
  console.error(`✘ 失败 ${failed} 项`);
  process.exit(1);
}
console.log('✔ 全部通过');
