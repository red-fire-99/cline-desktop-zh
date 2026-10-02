/* cline-zh 注入脚本 —— 运行时把界面英文文本按词典替换为中文
 * 约定: window.__CLINE_ZH_DICT__ = { "英文原文": "中文译文", ... }
 * 机制:
 *  1. 词典实时读取 window.__CLINE_ZH_DICT__, 避免注入时序导致的空词典;
 *  2. DOMContentLoaded 后全量翻译, MutationObserver 增量翻译, 定时器兜底;
 *  3. 跳过 script/style/textarea/code/pre/kbd, 保证代码块与输入内容不被翻译;
 *  4. 覆盖文本节点与 placeholder/title/aria-label/alt 等属性。
 */
(function () {
  'use strict';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip', 'data-placeholder'];
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, KBD: 1 };

  function getDict() { return window.__CLINE_ZH_DICT__ || {}; }

  // 词条命中: 先精确, 再尝试把连续空白折叠成一个空格 (React/JSX 换行渲染成多空白的情况)
  // 性能: 只有确实含多空白时才做折叠，避免每个文本节点都跑一次正则替换
  function lookup(dict, core) {
    var t = dict[core];
    if (t !== undefined) return t;
    if (!/\s\s|[\n\r\t]/.test(core)) return undefined;
    var collapsed = core.replace(/\s+/g, ' ');
    if (collapsed !== core) {
      t = dict[collapsed];
      if (t !== undefined) return t;
    }
    return undefined;
  }

  function inSkipSubtree(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP[n.tagName]) return true;
    }
    return false;
  }

  function getRegexes() {
    var d = window.__CLINE_ZH_DICT__ || {};
    if (reCacheSrc !== d) {
      reCacheSrc = d;
      reCache = [];
      for (var k in d) {
        try {
          if (k.slice(0, 4) === '(?i)') reCache.push([new RegExp(k.slice(4), 'i'), d[k]]);
          else if (k.charAt(0) === '^') reCache.push([new RegExp(k), d[k]]);
        } catch (e) { /* 忽略非法正则 */ }
      }
    }
    return reCache;
  }
  var reCache = null, reCacheSrc = null;

  // ---------- 片段级替换（适用于被包在 JSON / 长句里的运行时错误等） ----------
  // 整条文本没命中任何词条时，再对文本中出现的「片段」逐一替换；
  // 例如: The run failed: {"error":{"code":"...","message":"Error 429: Daily free limit reached..."}}
  var fragCache = null, fragCacheSrc = null;
  function getFragments() {
    var f = window.__CLINE_ZH_FRAG__;
    if (!f) return null;
    if (fragCacheSrc === f) return fragCache;
    fragCacheSrc = f;
    fragCache = Object.keys(f).filter(function (k) { return k && f[k]; })
      .sort(function (a, b) { return b.length - a.length; });   // 长的片段优先，避免被短片段抢先
    return fragCache;
  }
  var fragRe = null, fragReSrc = null;
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function getFragRe() {
    var f = window.__CLINE_ZH_FRAG__;
    if (fragReSrc === f) return fragRe;
    fragReSrc = f;
    var list = getFragments();
    if (!list || !list.length) { fragRe = null; return null; }
    try { fragRe = new RegExp(list.map(escapeRe).join('|')); } catch (e) { fragRe = null; }
    return fragRe;
  }
  function applyFragments(text) {
    // 性能关键: 先用「合并成一条正则」做一次命中判断，没命中就直接返回。
    // 否则每 1~2 秒的全量遍历会对每个文本节点逐条 indexOf 扫一遍整个片段词典，长会话下开销很大。
    var re = getFragRe();
    if (!re || text.length < 12 || !re.test(text)) return null;
    var list = getFragments();
    var dict = window.__CLINE_ZH_FRAG__;
    var out = text, hit = false;
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (out.indexOf(k) >= 0) { out = out.split(k).join(dict[k]); hit = true; }
    }
    return hit ? out : null;
  }

  var SRC_ATTR = 'data-zh-src';   // 记录译文对应的原文，便于词典更新后「二次翻译」
  var OUT_ATTR = 'data-zh-out';   // 记录我们实际写出的译文，用于判断节点是否被应用改过

  // 节点级缓存: 记录上次处理时的文本内容，内容没变就直接跳过。
  // 长会话里绝大多数节点是静态的，这一项能砍掉绝大部分重复匹配开销。
  var nodeSeen = new WeakMap();

  function translateTextNode(node, dict) {
    if (!node) return;
    var raw = node.nodeValue;
    if (!raw) return;
    var seen = nodeSeen.get(node);
    if (seen !== undefined && seen === raw) return;   // 内容未变 -> 跳过
    var core = raw.trim();
    if (!core) { nodeSeen.set(node, raw); return; }

    // 「原文 / 译文」双向记录：只有元素恰好只有一个子节点时才记录，避免干扰复合控件。
    var el = node.parentElement;
    var single = !!(el && el.childNodes.length === 1);
    var saved = null, lastOut = null;
    if (single) {
      try { saved = el.getAttribute(SRC_ATTR); lastOut = el.getAttribute(OUT_ATTR); } catch (e) { /* 忽略 */ }
    }
    // 旧版本只写 SRC_ATTR、没有译文记录，无法确认当前文本是否由我们写入 -> 清理掉，避免误伤。
    if (single && saved && lastOut === null) {
      try { el.removeAttribute(SRC_ATTR); saved = null; } catch (e) { /* 忽略 */ }
    }
    // 应用自己改过这个节点（内容与我们上次写出的译文不一致）——绝不能再用旧原文去覆盖它。
    // 典型场景: Cline 底部「提供商 / 模型」按钮复用同一 DOM 节点，先渲染占位标签，
    // 拿到真实值后改成 "Cline Usage-Billing"，若此时用旧原文重译会把真实值抹成「提供商」。
    var appChanged = !!(saved && lastOut !== null && lastOut !== core);

    // 若当前文本仍是我们上次写出的译文，说明译文可能过时，用原文重新翻译（支持词典热更新）。
    var fromOriginal = false;
    if (saved && !appChanged && lastOut === core) { core = saved; fromOriginal = true; }

    var out = null;
    var t = lookup(dict, core);
    if (t && t !== core) {
      out = t;
    } else {
      var res = getRegexes();
      for (var i = 0; i < res.length; i++) {
        var m = core.match(res[i][0]);
        if (m) {
          var rep = res[i][1].replace(/\$(\d)/g, function (_, g) { return m[+g] !== undefined ? m[+g] : ''; });
          // 关键：替换结果里可能还嵌着未翻译的英文片段（典型如「兜底规则 + 错误详情」），
          // 再过一遍片段词典，避免出现「只翻一半」。
          var fragRep = applyFragments(rep);
          if (fragRep) rep = fragRep;
          if (rep !== core) out = rep;
          break;
        }
      }
      // 整条未命中 -> 片段级替换
      if (out === null) out = applyFragments(core);
    }

    if (out && out !== raw) {
      // 统一按「首尾空白 + 译文」整段替换：
      // 走二次翻译路径时 raw 是旧译文、core 是原文，无法用 raw.replace(core, ...)
      var lead = (raw.match(/^\s*/) || [''])[0];
      var tail = (raw.match(/\s*$/) || [''])[0];
      var text = lead + out + tail;
      node.nodeValue = text;
      // 记录原文与译文（仅限「元素只有一个子节点」的安全场景）
      try {
        if (single && !fromOriginal) {
          el.setAttribute(SRC_ATTR, core);
          el.setAttribute(OUT_ATTR, text);
        }
      } catch (e) { /* 忽略 */ }
    } else if (single && appChanged) {
      // 应用更新过的节点现在没有对应译文 -> 丢弃过时记录，下轮按新内容正常处理
      try { el.removeAttribute(SRC_ATTR); el.removeAttribute(OUT_ATTR); } catch (e) { /* 忽略 */ }
    }
    nodeSeen.set(node, node.nodeValue);
  }

  function translateElement(el, dict) {
    if (el.nodeType !== 1) return;
    var res = getRegexes();
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (el.getAttribute) {
        var v = el.getAttribute(a);
        if (v) {
          var core = v.trim();
          var t = lookup(dict, core);
          if (t && t !== v) { el.setAttribute(a, t); continue; }
          for (var j = 0; j < res.length; j++) {
            var m = core.match(res[j][0]);
            if (m) {
              var rep = res[j][1].replace(/\$(\d)/g, function (_, g) { return m[+g] !== undefined ? m[+g] : ''; });
              if (rep !== core) el.setAttribute(a, v.replace(core, rep));
              break;
            }
          }
        }
      }
    }
  }

  function walk(root) {
    if (!root) return;
    var dict = getDict();
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (n) {
          if (n.nodeType === 3) {
            if (!n.parentElement || inSkipSubtree(n.parentElement)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
          // SKIP 元素(如 textarea/code)不翻译其文本内容, 但保留其 placeholder/title 等属性翻译
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      var list = [];
      while (walker.nextNode()) list.push(walker.currentNode);
      for (var i = 0; i < list.length; i++) {
        if (list[i].nodeType === 3) translateTextNode(list[i], dict);
        else translateElement(list[i], dict);
      }
    } catch (e) { /* 忽略单次遍历错误 */ }
  }

  var mo = new MutationObserver(function (muts) {
    var dict = getDict();
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData' && m.target) {
        if (!m.target.parentElement || !inSkipSubtree(m.target.parentElement)) translateTextNode(m.target, dict);
      } else if (m.type === 'attributes' && m.target) {
        translateElement(m.target, dict);
      } else if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 3) translateTextNode(n, dict);
          else if (n.nodeType === 1) walk(n);
        }
      }
    }
  });

  function observeRoot() {
    var root = document.documentElement;
    if (root) {
      try {
        mo.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ATTRS,
        });
        return true;
      } catch (e) { /* 稍后重试 */ }
    }
    return false;
  }

  function start() { walk(document.body || document.documentElement); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observeRoot();
      start();
      // 启动初期 React 水合会覆盖初始 DOM, 多做几次延迟补翻
      setTimeout(start, 600);
      setTimeout(start, 1500);
      setTimeout(start, 3500);
      setTimeout(start, 8000);
    });
  } else {
    observeRoot();
    start();
  }
  // 兜底: 周期性全量补翻。加自适应节流 —— 上一轮耗时过长就跳过一次，
  // 避免长会话中持续占用主线程造成界面卡顿。
  var lastWalkMs = 0;
  var skipTicks = 0;
  function timedStart() {
    if (skipTicks > 0) { skipTicks--; return; }
    var now = (window.performance && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };
    var t0 = now();
    start();
    lastWalkMs = now() - t0;
    if (lastWalkMs > 150) skipTicks = 1;
  }
  setInterval(timedStart, 2500);

  // 注意: 必须挂在最终对象上。之前先挂到 window.__clineZh、后面又整体覆盖，
  // 导致 stats() 实际丢失（读性能统计时拿到 undefined）。
  window.__clineZh = {
    version: 3,
    apply: start,
    setDict: function () { start(); },
    stats: function () {
      return {
        lastWalkMs: Math.round(lastWalkMs),
        dictSize: Object.keys(getDict()).length,
        fragCount: (getFragments() || []).length,
        tracked: document.querySelectorAll('[' + SRC_ATTR + ']').length
      };
    }
  };
})();
