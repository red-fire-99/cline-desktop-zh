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
  function lookup(dict, core) {
    var t = dict[core];
    if (t !== undefined) return t;
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

  function translateTextNode(node, dict) {
    var raw = node.nodeValue;
    if (!raw) return;
    var core = raw.trim();
    if (!core) return;
    var t = lookup(dict, core);
    if (t && t !== core) { node.nodeValue = raw.replace(core, t); return; }
    var res = getRegexes();
    for (var i = 0; i < res.length; i++) {
      var m = core.match(res[i][0]);
      if (m) {
        var rep = res[i][1].replace(/\$(\d)/g, function (_, g) { return m[+g] !== undefined ? m[+g] : ''; });
        if (rep !== core) node.nodeValue = raw.replace(core, rep);
        return;
      }
    }
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
  // 兜底: 每 1.2 秒全量补翻一次(词典未命中即跳过, 开销很小)
  setInterval(start, 1200);

  window.__clineZh = {
    version: 2,
    apply: start,
    setDict: function () { start(); },
  };
})();
