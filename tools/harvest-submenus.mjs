// 二级菜单采集: 右键菜单 / 下拉菜单 / 弹层 / 模型选择器
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
  if (r.exceptionDetails) throw new Error('page error: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
  return JSON.parse(r.result.value);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 抓取当前所有"弹层"(portal/popover/menu/dialog)内容
const DUMP_POPUPS = `(() => {
  const sel = '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [data-state="open"][role]';
  const els = [...document.querySelectorAll(sel)];
  const out = [];
  for (const el of els) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const txt = el.innerText || '';
    if (txt.trim()) out.push(txt);
  }
  return JSON.stringify([...new Set(out)]);
})()`;

const results = {};
async function capture(name) { const d = await evalJson(DUMP_POPUPS); const s = JSON.stringify(d, null, 1); results[name] = s; console.log(`[${name}]`, s.replaceAll('\n', ' ').slice(0, 600)); }

// 1) 右键会话列表第一项
try {
  await evalJson(`(() => {
    const item = document.querySelector('nav button');
    if (!item) return JSON.stringify('no item');
    const r = item.getBoundingClientRect();
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 10, button: 2 }));
    return JSON.stringify('ok');
  })()`);
  await sleep(900);
  await capture('contextmenu-session');
  await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
  await sleep(400);
} catch (e) { console.log('contextmenu failed:', e.message.slice(0, 120)); }

// 2) 排序下拉
async function clickByLabel(sel, labels) {
  return evalJson(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const labels = ${JSON.stringify(labels)};
    const el = els.find(e => {
      const v = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
      return labels.some(L => v === L || v.includes(L));
    });
    if (!el) return JSON.stringify('not found');
    el.click();
    return JSON.stringify('ok');
  })()`);
}
for (const [name, sel, labels] of [
  ['sort-menu', '[aria-label], [title]', ['会话排序', 'Sort sessions', '排序']],
  ['filter-menu', '[aria-label], [title]', ['筛选会话', 'Filter sessions', '筛选']],
]) {
  try {
    const r = await clickByLabel(sel, labels);
    if (r !== 'ok') { console.log(`[${name}]`, r); continue; }
    await sleep(800);
    await capture(name);
    await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
    await sleep(400);
  } catch (e) { console.log(name, 'failed:', e.message.slice(0, 120)); }
}

// 3) 模型选择器(输入框下方的模型按钮) — 找包含 "(free)" 或模型名的按钮
try {
  const r = await evalJson(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && /GLM|Claude|GPT|Gemini|DeepSeek|Kimi/i.test(b.textContent) && b.textContent.length < 80);
    if (!btns.length) return JSON.stringify('no model btn');
    btns[btns.length - 1].click();
    return JSON.stringify('ok');
  })()`);
  if (r === 'ok') { await sleep(1000); await capture('model-selector'); await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
    await sleep(400); }
  else console.log('[model-selector]', r);
} catch (e) { console.log('model-selector failed:', e.message.slice(0, 120)); }

// 4) 通知中心 (F8)
try {
  await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true })); return 1; })()`);
  await sleep(800);
  await capture('notifications');
  await evalJson(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
} catch (e) { console.log('notifications failed:', e.message.slice(0, 120)); }

fs.writeFileSync(path.join(import.meta.dirname, 'out', 'submenus.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('\n已保存 out\\submenus.json');
ws.close();
process.exit(0);
