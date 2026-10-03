/**
 * scan-missing 的过滤规则回归测试。
 * 目标：真实漏翻文案必须被检出，产品名/域名/数字混排必须被排除。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(resolve(REPO, 'tools/scan-missing.mjs'), 'utf8');
const body = SRC.match(/function looksLikeNoise\(text\)\s*\{([\s\S]*?)\n\}/)[1];
const looksLikeNoise = new Function('text', body);

// [文本, 是否应视为噪声（true=排除, false=应作为候选报出）]
const cases = [
  ['No teammate runs are currently in progress. Continue coordination using these updates.', false],
  ['System-delivered teammate async run updates:', false],
  ['Response stream ended without a finish reason.', false],
  ['Capability owner client core-x disconnected before request was resolved.', false],
  ['Failed to create stream: inference request failed', false],
  ['Cline Usage-Billing', true],
  ['Space Bunny Alpha (free)', true],
  ['Google AI Studio', true],
  ['750ms -> 12ms', true],
  ['czj.bengbu.gov.cn', true],
  ['https://openrouter.ai/settings/integrations', true],
  ['X-RateLimit-Remaining', true],
  ['2.4.1', true],
];

let pass = 0;
for (const [text, shouldNoise] of cases) {
  const noisy = looksLikeNoise(text);
  const ok = noisy === shouldNoise;
  if (ok) pass++;
  console.log(
    (ok ? '  PASS  ' : '  FAIL  ') +
    (noisy ? '[排除] ' : '[候选] ') +
    JSON.stringify(text.length > 62 ? text.slice(0, 62) + '...' : text)
  );
}
console.log('\n过滤规则回归：' + pass + '/' + cases.length + ' 通过');
process.exit(pass === cases.length ? 0 : 1);
