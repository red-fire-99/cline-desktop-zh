// 读取仓库根目录 config.json（端口 / 语言），供各工具共用
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = { port: 9223, lang: 'zh-CN' };

export function readConfig() {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT_DIR, 'config.json'), 'utf8'));
    return { ...DEFAULTS, ...cfg };
  } catch {
    return { ...DEFAULTS };
  }
}

// 端口优先级: --port 参数 > CDP_PORT 环境变量 > config.json > 9223
export function portFromArgv(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--port');
  if (i >= 0 && argv[i + 1]) return parseInt(argv[i + 1], 10);
  if (process.env.CDP_PORT) return parseInt(process.env.CDP_PORT, 10);
  return readConfig().port;
}

// 仓库根目录下的相对路径（如 dict / logs / tools/out）
export function rootPath(...parts) {
  return join(ROOT_DIR, ...parts);
}
