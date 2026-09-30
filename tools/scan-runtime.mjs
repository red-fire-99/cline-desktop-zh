// 从 out/js-chunks 里扫出任务执行期的 UI 文案(批准/拒绝/工具卡片等), 与词典比对找漏
const fs = await import('node:fs');
const path = await import('node:path');
const dir = path.join(import.meta.dirname, 'out', 'js-chunks');
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'zh-cn.json'), 'utf8'));
// 关键词白名单: 只挑任务执行/审批/工具相关的候选
const kw = /(approv|reject|denied|denied|retry|resume|proceed|read file|edit file|write file|list file|search file|insert content|replace content|execute|run command|tool call|working on|checkpoint|restore|auto-?approve|permission|allow once|allow always|always allow|deny|continue|skip|ignore|file changes|review changes|save changes|accept|undo|keep|discard|apply|rollback|revert|loading|analyzing|reading|editing|writing|creating|searching|scanning|fetching|merging|pushing|pulling|cloning|committing)/i;
const chunks = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const hits = new Map();
const re = /"((?:[^"\\\n]|\\.){2,90})"/g;
for (const f of chunks) {
  const js = fs.readFileSync(path.join(dir, f), 'utf8');
  let m;
  while ((m = re.exec(js))) {
    let s;
    try { s = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    if (!kw.test(s)) continue;
    if (s.length < 3 || s.length > 90) continue;
    if (!/^[A-Za-z0-9 '’.,:!?()&%/+\-–—]+$/.test(s)) continue;
    if (!/[A-Za-z]{2}/.test(s)) continue;
    if (/^[a-z0-9_./$-]+$/.test(s) && !/\s/.test(s)) continue;
    hits.set(s, (hits.get(s) || 0) + 1);
  }
}
const missing = [...hits.keys()].filter((s) => !(s in dict)).sort((a, b) => (hits.get(b) || 0) - (hits.get(a) || 0));
const out = missing.map((s) => `${hits.get(s)}\t${s}`);
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'runtime-strings.txt'), out.join('\n'), 'utf8');
console.log(`扫描 ${chunks.length} 个 chunk, 命中 ${hits.size} 条, 其中 ${missing.length} 条不在词典 -> out\\runtime-strings.txt`);
console.log(out.slice(0, 60).join('\n'));
process.exit(0);
