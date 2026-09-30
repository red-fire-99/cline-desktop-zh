// 交互式采集: 点开设置面板, 遍历各设置分类, 抓取全部文案
import { portFromArgv } from './config.mjs';
const PORT = portFromArgv();
const fs = await import('node:fs');
const path = await import('node:path');
fs.mkdirSync(path.join(import.meta.dirname, 'out'), { recursive: true });
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return JSON.parse(r.result.value);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 关闭可能已打开的设置(Esc), 再点开 Settings
await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
await sleep(500);
const opened = await evalJson(`(() => {
  const btn = document.querySelector('[aria-label="Settings"], [title="Settings"], [aria-label="设置"], [title="设置"]');
  if (!btn) return JSON.stringify('no settings button');
  btn.click();
  return JSON.stringify('clicked');
})()`);
console.log('打开设置:', opened);
await sleep(1500);

// 收集设置面板文本 + 找出设置内的导航项
const dump1 = await evalJson(`(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const navItems = [...dlg.querySelectorAll('button, a, [role="menuitem"], [role="tab"]')]
    .filter(e => e.offsetParent !== null && e.textContent.trim() && e.textContent.trim().length <= 24)
    .map(e => e.textContent.trim());
  return JSON.stringify({ text: dlg.innerText, navItems: [...new Set(navItems)], attrs: [...new Set([...dlg.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')).filter(Boolean))] });
})()`);
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'settings-main.txt'), dump1.text + '\n\n=== 导航项 ===\n' + dump1.navItems.join('\n') + '\n\n=== 属性文案 ===\n' + dump1.attrs.join('\n'), 'utf8');
console.log('设置主面板文案已保存, 导航项', dump1.navItems.length, '个');

// 逐个点击导航项并抓取
const seen = new Set();
const allDumps = [];
const navTargets = [...new Set(dump1.navItems)];
for (const label of navTargets) {
  try {
    const clicked = await evalJson(`(() => {
      const dlg = document.querySelector('[role="dialog"]') || document.body;
      const items = [...dlg.querySelectorAll('button, a, [role="menuitem"], [role="tab"]')]
        .filter(e => e.offsetParent !== null && e.textContent.trim() === ${JSON.stringify(label)});
      if (!items.length) return JSON.stringify('not found');
      items[0].click();
      return JSON.stringify('ok');
    })()`);
    if (clicked !== 'ok') continue;
    await sleep(900);
    const d = await evalJson(`(() => {
      const dlg = document.querySelector('[role="dialog"]') || document.body;
      return JSON.stringify({ text: dlg.innerText, attrs: [...new Set([...dlg.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')).filter(Boolean))] });
    })()`);
    const key = d.text.slice(0, 300);
    if (!seen.has(key)) {
      seen.add(key);
      allDumps.push({ label, text: d.text, attrs: d.attrs });
      console.log('已采集:', label, `(${d.text.length} 字符)`);
    }
  } catch (e) {
    console.log('跳过:', label, e.message.slice(0, 120));
  }
}
for (const d of allDumps) {
  const safe = d.label.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 30) || 'unnamed';
  fs.writeFileSync(path.join(import.meta.dirname, 'out', `settings-${safe}.txt`), d.text + '\n\n=== 属性文案 ===\n' + d.attrs.join('\n'), 'utf8');
}
// 汇总未翻译英文行
const allText = allDumps.map((d) => d.text).join('\n') + '\n' + allDumps.map((d) => d.attrs.join('\n')).join('\n') + '\n' + dump1.text;
const dict = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'zh-cn.json'), 'utf8'));
const lines = [...new Set(allText.split('\n').map((l) => l.trim()).filter((l) => l && /[A-Za-z]{2}/.test(l) && !dict[l] && !/[\u4e00-\u9fff]/.test(l)))];
fs.writeFileSync(path.join(import.meta.dirname, 'out', 'settings-untranslated.txt'), lines.join('\n'), 'utf8');
console.log('\n完成: 未翻译行', lines.length, '条 -> out\\settings-untranslated.txt');
ws.close();
process.exit(0);
