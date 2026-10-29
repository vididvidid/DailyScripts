/*
 * File: codeforcesPrint.js
 * Author: vididvidid 
 * Created: 2026-09-13 02:52:10
 */

// ==UserScript==
// @name         Codeforces ICPC Print (single problem)
// @namespace    https://codeforces.com/
// @version      2.1
// @description  A4 portrait print of ONE problem — ICPC-style. Icon next to title.
// @author       you
// @match        https://codeforces.com/problemset/problem/*/*
// @match        https://codeforces.com/contest/*/problem/*
// @match        https://codeforces.com/contest/*/problems*
// @match        https://codeforces.com/gym/*/problem/*
// @match        https://codeforces.com/gym/*/problems*
// @match        https://codeforces.com/group/*/contest/*/problem/*
// @match        https://codeforces.com/group/*/contest/*/problems*
// @match        https://*.codeforces.com/problemset/problem/*/*
// @match        https://*.codeforces.com/contest/*/problem/*
// @match        https://*.codeforces.com/contest/*/problems*
// @match        https://*.codeforces.com/gym/*/problem/*
// @match        https://*.codeforces.com/gym/*/problems*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BTN_CLASS = 'cf-icpc-print-btn';

  function absUrl(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function textOf(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function contestName() {
    const a = document.querySelector('#sidebar .rtable th a, .contest-name, .left a[href*="/contest/"]');
    return a ? a.textContent.trim() : '';
  }

  function problemMeta(root) {
    const header = root.querySelector('.header') || root;
    const title = textOf(header.querySelector('.title')) || document.title;
    const grab = (sel) => {
      const n = header.querySelector(sel);
      if (!n) return '';
      const clone = n.cloneNode(true);
      clone.querySelectorAll('.property-title').forEach((p) => p.remove());
      return textOf(clone);
    };
    return {
      title,
      time: grab('.time-limit') || '1 second',
      memory: grab('.memory-limit') || '256 megabytes',
      input: grab('.input-file') || 'standard input',
      output: grab('.output-file') || 'standard output',
      contest: contestName(),
    };
  }

  function collectStyles() {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => '<link rel="stylesheet" href="' + absUrl(l.href) + '">')
      .join('\n');
    const extras = Array.from(document.querySelectorAll('style'))
      .map((s) => '<style>' + s.textContent + '</style>')
      .join('\n');
    return links + '\n' + extras;
  }

  function rewriteSamples(statement) {
    const wrap = statement.querySelector('.sample-tests');
    if (!wrap) return;

    const blocks = wrap.querySelectorAll('.sample-test');
    const pairs = [];

    if (blocks.length) {
      blocks.forEach((b) => {
        const inputs = Array.from(b.querySelectorAll('.input'));
        const outputs = Array.from(b.querySelectorAll('.output'));
        const n = Math.max(inputs.length, outputs.length);
        for (let i = 0; i < n; i++) {
          pairs.push({
            inn: inputs[i] ? preText(inputs[i]) : '',
            out: outputs[i] ? preText(outputs[i]) : '',
          });
        }
      });
    } else {
      const inputs = Array.from(wrap.querySelectorAll('.input'));
      const outputs = Array.from(wrap.querySelectorAll('.output'));
      const n = Math.max(inputs.length, outputs.length);
      for (let i = 0; i < n; i++) {
        pairs.push({
          inn: inputs[i] ? preText(inputs[i]) : '',
          out: outputs[i] ? preText(outputs[i]) : '',
        });
      }
    }
    if (!pairs.length) return;

    const table = document.createElement('table');
    table.className = 'icpc-samples';
    pairs.forEach((p, idx) => {
      const suffix = pairs.length > 1 ? ' ' + (idx + 1) : '';
      table.insertAdjacentHTML(
        'beforeend',
        '<thead><tr><th>Sample Input' + suffix + '</th><th>Sample Output' + suffix + '</th></tr></thead>' +
        '<tbody><tr><td><pre>' + escapeHtml(p.inn) + '</pre></td><td><pre>' + escapeHtml(p.out) + '</pre></td></tr></tbody>'
      );
    });

    const title = wrap.querySelector('.section-title');
    wrap.innerHTML = '';
    if (title) {
      wrap.appendChild(title);
    } else {
      const h = document.createElement('div');
      h.className = 'section-title';
      h.textContent = 'Examples';
      wrap.appendChild(h);
    }
    wrap.appendChild(table);
  }

  function preText(block) {
    const pre = block.querySelector('pre');
    if (pre) return pre.innerText.replace(/\n+$/, '');
    const c = block.cloneNode(true);
    c.querySelectorAll('.title, .input-output-copier').forEach((x) => x.remove());
    return c.innerText.replace(/\n+$/, '').trim();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function cleanStatement(src) {
    const statement = src.cloneNode(true);
    statement.querySelectorAll(
      '.input-output-copier, .diff-notifier, .testCaseMarker, script, .' + BTN_CLASS
    ).forEach((e) => e.remove());

    statement.querySelectorAll('img').forEach((img) => {
      if (img.src) img.src = absUrl(img.src);
    });
    statement.querySelectorAll('a[href]').forEach((a) => {
      a.href = absUrl(a.getAttribute('href'));
    });

    rewriteSamples(statement);

    const header = statement.querySelector('.header');
    if (header) header.remove();

    return statement;
  }

  function printCSS() {
    return [
      '@page { size: A4 portrait; margin: 14mm 16mm 16mm 16mm; }',
      'html, body { background: #fff !important; color: #000; margin: 0; padding: 0;',
      '  font-family: "Times New Roman", Times, "Nimbus Roman", serif; }',
      'body { font-size: 11pt; line-height: 1.42; }',
      '@media print { .no-print { display: none !important; }',
      '  a[href]:after { content: none !important; }',
      '  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
      '.toolbar { position: sticky; top: 0; z-index: 20; display: flex; gap: 8px; align-items: center;',
      '  background: #222; color: #fff; padding: 8px 12px; font-family: system-ui, sans-serif; font-size: 13px; }',
      '.toolbar button { background: #fff; color: #111; border: 0; border-radius: 4px;',
      '  padding: 6px 12px; cursor: pointer; font-weight: 600; }',
      '.toolbar span { opacity: .85; }',
      '.sheet { max-width: 190mm; margin: 0 auto; padding: 8px 0 24px; }',
      '.icpc-title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0 0 6px; letter-spacing: .2px; }',
      '.icpc-contest { text-align: center; font-size: 10pt; color: #333; margin: 0 0 10px; font-style: italic; }',
      '.icpc-meta { width: 100%; border-collapse: collapse; margin: 0 auto 14px; font-size: 10.5pt; max-width: 150mm; }',
      '.icpc-meta td { padding: 2px 10px; vertical-align: top; }',
      '.icpc-meta .k { font-weight: 700; width: 28%; }',
      '.icpc-meta .v { width: 22%; }',
      '.problem-statement { margin: 0 !important; font-size: 11pt !important; }',
      '.problem-statement p { margin: 0 0 .7em; text-align: justify; }',
      '.problem-statement .section-title { font-family: "Times New Roman", Times, serif; font-size: 13pt;',
      '  font-weight: 700; margin: 12px 0 6px; border-bottom: 1px solid #000; padding-bottom: 2px; }',
      '.problem-statement ul, .problem-statement ol { margin: 0 0 .7em 1.2em; }',
      '.problem-statement li { margin: 0 0 .25em; }',
      '.icpc-samples { width: 100%; border-collapse: collapse; margin: 6px 0 14px; table-layout: fixed; page-break-inside: avoid; }',
      '.icpc-samples th, .icpc-samples td { border: 1.2px solid #000; vertical-align: top; width: 50%; }',
      '.icpc-samples th { background: #efefef; font-family: "Times New Roman", Times, serif; font-size: 11pt;',
      '  font-weight: 700; text-align: left; padding: 4px 8px; }',
      '.icpc-samples td { padding: 6px 8px; }',
      '.icpc-samples pre { margin: 0; font-family: "Courier New", Courier, Consolas, monospace;',
      '  font-size: 10pt; line-height: 1.3; white-space: pre-wrap; word-break: break-word; }',
      '.footer-line { margin-top: 18px; border-top: 1px solid #999; padding-top: 6px; font-size: 9pt;',
      '  color: #444; display: flex; justify-content: space-between; font-family: system-ui, sans-serif; }',
      '.tex-font-style-tt, .tt, code, .tex-span { font-family: "Courier New", Consolas, monospace; }',
    ].join('\n');
  }

  function openPrint(statementEl) {
    const meta = problemMeta(statementEl);
    const body = cleanStatement(statementEl);

    const win = window.open('', '_blank');
    if (!win) {
      alert('Allow pop-ups for codeforces.com, then click the print icon again.');
      return;
    }

    win.document.open();
    win.document.write(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>' + escapeHtml(meta.title) + '</title>' +
      collectStyles() +
      '<style>' + printCSS() + '</style></head><body>' +
      '<div class="toolbar no-print">' +
      '<button onclick="window.print()">Print / Save PDF</button>' +
      '<button onclick="window.close()">Close</button>' +
      '<span>Paper: A4 &nbsp;·&nbsp; Layout: Portrait &nbsp;·&nbsp; Headers and footers: Off</span>' +
      '</div>' +
      '<div class="sheet">' +
      '<div class="icpc-title">' + escapeHtml(meta.title) + '</div>' +
      (meta.contest ? '<div class="icpc-contest">' + escapeHtml(meta.contest) + '</div>' : '') +
      '<table class="icpc-meta"><tr>' +
      '<td class="k">Time limit:</td><td class="v">' + escapeHtml(meta.time) + '</td>' +
      '<td class="k">Memory limit:</td><td class="v">' + escapeHtml(meta.memory) + '</td>' +
      '</tr><tr>' +
      '<td class="k">Input:</td><td class="v">' + escapeHtml(meta.input) + '</td>' +
      '<td class="k">Output:</td><td class="v">' + escapeHtml(meta.output) + '</td>' +
      '</tr></table>' +
      body.outerHTML +
      '<div class="footer-line"><span>' + escapeHtml(meta.contest || 'Codeforces') +
      '</span><span>' + escapeHtml(meta.title) + '</span></div>' +
      '</div></body></html>'
    );
    win.document.close();

    const kick = function () {
      try {
        const mj = win.MathJax;
        if (mj && mj.Hub) {
          mj.Hub.Queue(['Typeset', mj.Hub], function () {
            setTimeout(function () { win.print(); }, 200);
          });
        } else {
          setTimeout(function () { win.print(); }, 400);
        }
      } catch (e) {
        win.print();
      }
    };
    setTimeout(kick, 600);
  }

  function makeBtn(statementEl) {
    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.type = 'button';
    btn.title = 'Print this problem (A4 / ICPC style)';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;margin-left:8px;border:1px solid #b5b5b5;border-radius:4px;background:#f6f6f6;cursor:pointer;color:#333;vertical-align:middle;line-height:0;';
    btn.onmouseenter = function () { btn.style.background = '#e8f0fe'; btn.style.color = '#174ea6'; };
    btn.onmouseleave = function () { btn.style.background = '#f6f6f6'; btn.style.color = '#333'; };
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const go = function () { openPrint(statementEl); };
      const mj = window.MathJax;
      if (mj && mj.Hub) mj.Hub.Queue(go);
      else go();
    });
    return btn;
  }

  function attach() {
    document.querySelectorAll('.problem-statement').forEach(function (st) {
      const title = st.querySelector('.header .title');
      if (!title || title.querySelector('.' + BTN_CLASS)) return;
      title.appendChild(makeBtn(st));
    });
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
})();
