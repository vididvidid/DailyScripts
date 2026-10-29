/*
 * File: gmailOtp.js
 * Author: vididvidid
 * Created: 2026-10-24
 *
 * versions:
 *
 * 0.4.0          never hands out an old code: codes already given out are
 *                remembered, mail older than the OTP box doesn't count, and
 *                a Gmail conversation ("noreply 2"), whose preview is an older
 *                mail's, is opened and its newest mail read. Split boxes are
 *                filled by pasting, then by typing digit by digit; the boxes
 *                are read back and "Filled" is only shown if they hold the
 *                code. When the page clears the boxes (wrong code, resend),
 *                it offers to fetch the new code
 *
 * 0.3.0          the fallback Gmail tab opens as ?monk=lite, so with monk.js
 *                installed it loads without images, fonts or third-party
 *                scripts. Experimental (menu, off by default): open Gmail in
 *                a narrow window beside the page instead of a tab — it stays
 *                on screen so it draws, and you never leave your page
 *
 * 0.2.0          much faster, and no more switching tabs: the code is read
 *                from Gmail's Atom feed (your unread inbox as a small XML
 *                list, fetched with the browser's own Gmail cookies) every
 *                2 seconds — no tab at all. A Gmail tab is only the fallback
 *                (feed unavailable, or no code in any preview after 20 s),
 *                and it now opens in front, because Chrome doesn't let a
 *                hidden tab draw Gmail's mail list; it closes back to your
 *                page once the code is found
 *
 * 0.1.0          spots an OTP box on any page, opens Gmail in a background
 *                tab of the same browser (no API, no token), reads the
 *                newest mail for the code and fills it in — automatically
 *                only when the mail came from the site's own domain
 */

/**
 * ============================================================================
 * HOW IT WORKS
 * ============================================================================
 * One script, two roles, talking through Tampermonkey storage:
 *
 *   any page   finds an OTP box (autocomplete="one-time-code", a row of 4–8
 *              one-character boxes, or a code/OTP/verification field next to
 *              matching text). If the page says the code went to your email
 *              it asks right away; otherwise a "📩 Get code from Gmail"
 *              button waits for a click.
 *
 *   feed       asking = reading Gmail's Atom feed (mail.google.com/mail/u/N/
 *              feed/atom: the unread inbox as XML — sender, subject, preview,
 *              time) every 2 s with the browser's own cookies. Most OTP mails
 *              carry the code in the preview, so this is usually it.
 *
 *   Gmail tab  fallback when the feed fails, or has no code after 20 s
 *              (mail already read, or code below the preview). Opened in
 *              front — Chrome doesn't let a hidden tab draw Gmail's list.
 *              The tab searches
 *              `in:anywhere newer_than:1d -from:me` (so Updates, Promotions
 *              and Spam count too), reads sender + subject + preview of the
 *              newest rows that arrived after the OTP page showed up, and if
 *              a likely mail has no code in its preview, opens it and reads
 *              the body. It searches again every few seconds for 3 minutes,
 *              so a mail that's still on its way is caught too. The answer
 *              goes back through storage; the page then closes the tab and
 *              you land back on it.
 *              Gmail tabs you had open already are never touched — only a
 *              tab that loaded after the request acts.
 *
 *   filling    the code is filled automatically only if the sender's domain
 *              matches the site (amazon.in mail on amazon.in). Anything else
 *              shows the code with Fill / Copy buttons — a look-alike
 *              phishing page never gets your real code without your click.
 *              Nothing is ever submitted.
 *
 * Gmail's class names (tr.zA rows, .y2 preview, .a3s body …) are old and
 * stable but not promised; if Gmail changes them, this is where it breaks.
 */

// ==UserScript==
// @name         Gmail OTP autofill
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.4.0
// @description  Spots OTP boxes, reads the code from your newest Gmail in a background tab, and fills it in
// @author       vididvidid
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      mail.google.com
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── 1. Config ─────────────────────────────────────────────────────────────
  const REQ_KEY = 'otp-request';
  const RES_KEY = 'otp-result';
  const SET_KEY = 'otp-settings';
  const WAIT_MS = 3 * 60 * 1000;       // give up after this long
  const LOOKBACK_MS = 60 * 1000;       // mails up to this much older than the OTP box count
  const USED_KEY = 'otp-used';         // codes already handed out — never again
  const RESEARCH_MS = 8000;            // Gmail tab re-runs its search this often
  const ROWS_TO_READ = 8;
  const FEED_POLL_MS = 2000;           // check Gmail's Atom feed this often
  const FEED_ALONE_MS = 20000;         // then also open a Gmail tab
  const SEARCH = 'in:anywhere newer_than:1d -from:me';

  const KEYWORDS = /\b(otp|one[\s-]?time|verification|verify|passcode|security code|login code|sign[\s-]?in|auth(entication)? code|confirmation code|2fa|mfa|pin)\b|\bcode\b|कोड|ओटीपी/i;
  const NOT_OTP_FIELD = /promo|coupon|voucher|discount|gift|referr|zip|postal|pin\s*code|pincode|country|area|captcha/i;
  const SAYS_EMAIL = /e-?mail|inbox|gmail|@[a-z0-9-]+\.|check your (mail|inbox)/i;
  const SAYS_PHONE = /\bsms\b|text message|phone|mobile|whatsapp|authenticator app/i;

  const settings = () => ({ autoFetch: true, autoFill: true, account: 0, beside: false, ...GM_getValue(SET_KEY, {}) });
  const saveSettings = patch => GM_setValue(SET_KEY, { ...settings(), ...patch });

  // ── 2. Shared helpers ─────────────────────────────────────────────────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }

  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    && getComputedStyle(el).visibility !== 'hidden';

  // Second-level label: mail.amazon.in → amazon, accounts.google.com → google.
  function brand(hostOrDomain) {
    const p = hostOrDomain.toLowerCase().split('.').filter(Boolean);
    if (p.length < 2) return p[0] || '';
    const sld = /^(co|com|org|net|gov|ac|edu|gen|nic)$/.test(p[p.length - 2]) && p.length > 2;
    return p[p.length - (sld ? 3 : 2)];
  }

  // Best-looking code in a piece of mail text, or null.
  function extractCode(text, len, skip = []) {
    const t = text.replace(/\s+/g, ' ');
    const re = /(?<![\d.,/]|[a-z]{2})(\d{4,8}|\d{3}[ -]\d{3})(?![\w%]|[.,]\d)/g;
    let best = null;
    for (let m; (m = re.exec(t));) {
      const code = m[1].replace(/\D/g, '');
      const before = t.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
      let score = 0;
      if (KEYWORDS.test(before) || KEYWORDS.test(after)) score += 5;
      if (/(code|otp|pin)\s*(is|:)?\s*$/.test(before)) score += 3;
      if (len) score += code.length === len ? 3 : -3;
      else if (code.length === 6) score += 1;
      if (/(₹|rs\.?|inr|\$|usd|€|£)\s*$/.test(before)) score -= 6;
      if (/(order|invoice|ref|ticket|#|no\.?)\s*$/.test(before)) score -= 4;
      if (/(am|pm|hrs|minutes|mins|seconds)\b/.test(after.slice(0, 6))) score -= 4;
      if (code.length === 4 && /^(19|20)\d\d$/.test(code)) score -= 4;
      if (skip.includes(code)) continue;
      if (!best || score > best.score) best = { code, score };
    }
    return best && best.score >= 4 ? best.code : null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── 3. Gmail side ───────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  if (location.hostname === 'mail.google.com') {
    const req = GM_getValue(REQ_KEY, null);
    // Only the tab that was opened for this request works; your own Gmail
    // tabs (loaded before it) stay untouched.
    if (!req || req.done || Date.now() - req.at > WAIT_MS || performance.timeOrigin < req.at - 2000) return;
    gmailWorker(req);
    return;
  }

  async function gmailWorker(req) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const opened = new Set();
    const searchHash = n => '#search/' + encodeURIComponent(SEARCH.replace('1d', n % 2 ? '2d' : '1d'));
    let lastSearch = 0, n = 0;

    const answer = (code, from, subject) => {
      GM_setValue(RES_KEY, { id: req.id, code, from, subject, at: Date.now() });
      GM_setValue(REQ_KEY, { ...req, done: true });
    };
    const stillWanted = () => {
      const cur = GM_getValue(REQ_KEY, null);
      return cur && cur.id === req.id && !cur.done && Date.now() - req.at < WAIT_MS;
    };

    const rowInfo = row => {
      const who = row.querySelector('[email]');
      const when = row.querySelector('td.xW span[title], span.bq3[title]');
      const t = when ? Date.parse(when.getAttribute('title')) : NaN;
      return {
        from: who ? who.getAttribute('email') : '',
        name: who ? who.textContent.trim() : '',
        subject: (row.querySelector('.bog') || {}).textContent || '',
        text: row.innerText,
        time: t,
        key: row.innerText.slice(0, 120),
      };
    };

    while (stillWanted()) {
      // Search results don't refresh by themselves: flip between two
      // equivalent queries so Gmail runs the search again.
      if (Date.now() - lastSearch > RESEARCH_MS) {
        location.hash = searchHash(n++);
        lastSearch = Date.now();
        await sleep(2500);
      }
      const main = document.querySelector('div[role="main"]');
      const rows = main ? [...main.querySelectorAll('tr.zA')].filter(visible).slice(0, ROWS_TO_READ) : [];
      for (const [i, row] of rows.entries()) {
        const r = rowInfo(row);
        // Undated or unparseable (another locale): trust only the top rows.
        const fresh = isNaN(r.time) ? i < 3 : r.time >= req.since - 60000;
        if (!fresh) continue;
        // A conversation ("noreply 2") shows an older mail's preview, so
        // its preview can't be trusted: open it and read the newest mail.
        const thread = !!row.querySelector('.bx0');
        const code = !thread && extractCode(r.text, req.len, req.skip);
        if (code) return answer(code, r.from || r.name, r.subject);
        if (opened.has(r.key) || !KEYWORDS.test(r.text)) continue;
        // Likely an OTP mail with the code below the preview: open it.
        opened.add(r.key);
        const target = row.querySelector('td.xY') || row;
        for (const type of ['mousedown', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        let body = null;
        for (let k = 0; k < 20 && !body; k++) {
          await sleep(400);
          body = [...document.querySelectorAll('div.a3s')].filter(visible).pop();
        }
        if (body) {
          const bodyCode = extractCode(r.subject + ' ' + body.innerText, req.len, req.skip);
          if (bodyCode) return answer(bodyCode, r.from || r.name, r.subject);
        }
        lastSearch = 0;   // back to the list
        break;
      }
      await sleep(1500);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── 4. Page side ────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  let boxSeenAt = 0;          // when the OTP box showed up — mail before it is old
  let filledCode = null;      // what we last put in the boxes
  let target = null;          // { kind: 'single' | 'split', els, len, strong }
  let asked = false, tab = null, timer = null, ui = null;

  function describe(el) {
    const label = (el.labels && el.labels[0] && el.labels[0].textContent) || '';
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.className, label].join(' ');
  }

  function findTarget() {
    const inputs = [...document.querySelectorAll('input')].filter(i =>
      /^(text|tel|number|password|)$/.test(i.type) && !i.disabled && !i.readOnly && visible(i));
    const pageText = (document.body.innerText || '').slice(0, 5000);
    const otpPage = KEYWORDS.test(pageText);

    const one = inputs.find(i => i.autocomplete === 'one-time-code');
    if (one) return { kind: 'single', els: [one], len: one.maxLength > 3 && one.maxLength < 9 ? one.maxLength : 0, strong: true, pageText };

    // A row of one-character boxes sharing a parent (or grandparent).
    const groups = new Map();
    for (const i of inputs.filter(i => i.maxLength === 1)) {
      const box = i.parentElement && i.parentElement.parentElement;
      const key = i.parentElement.querySelectorAll('input').length > 1 ? i.parentElement : box;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const els of groups.values()) {
      if (els.length >= 4 && els.length <= 8) return { kind: 'split', els, len: els.length, strong: otpPage, pageText };
    }

    const named = inputs.find(i => {
      const d = describe(i);
      return /otp|one.?time|verif|passcode|2fa|mfa|totp|security.?code|auth.?code|\bcode\b|\bpin\b|token/i.test(d) && !NOT_OTP_FIELD.test(d);
    });
    if (named) {
      const len = named.maxLength > 3 && named.maxLength < 9 ? named.maxLength : 0;
      return { kind: 'single', els: [named], len, strong: otpPage, pageText };
    }
    return null;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nativeSet = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);   // the native setter, so React/Vue notice
  };

  function setValue(el, v) {
    el.focus();
    nativeSet(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // One keystroke the way a keyboard makes it, for boxes that run their own
  // key handling (take a digit, jump to the next box).
  function typeChar(el, ch) {
    el.focus();
    const k = { key: ch, code: 'Digit' + ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', k));
    el.dispatchEvent(new KeyboardEvent('keypress', k));
    nativeSet(el, ch);
    el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', k));
  }

  function paste(el, code) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', code);
      el.focus();
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {}
  }

  // Fill, then read the boxes back: true only if they really hold the code.
  async function fill(code) {
    const t = findTarget() || target;
    if (!t) return false;
    const now = () => (findTarget() || t).els.map(e => e.value).join('');
    if (t.kind === 'single') {
      setValue(t.els[0], code);
      await sleep(150);
      return now() === code;
    }
    // Split boxes: most OTP widgets take a pasted code on the first box.
    paste(t.els[0], code);
    await sleep(200);
    if (now() === code) return true;
    // Otherwise type it digit by digit, going where the page moves focus.
    for (const el of t.els) nativeSet(el, '');
    let el = t.els[0];
    for (let i = 0; i < code.length; i++) {
      typeChar(el, code[i]);
      await sleep(40);
      const els = (findTarget() || t).els;
      const next = document.activeElement;
      el = els.includes(next) && next.value === '' ? next : els[i + 1];
      if (!el) break;
    }
    await sleep(200);
    if (now() === code) return true;
    // Last resort: set every box directly.
    (findTarget() || t).els.forEach((e, i) => setValue(e, code[i] || ''));
    await sleep(200);
    return now() === code;
  }

  // ── UI ──
  const CSS = `
    #gotp { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; max-width: min(340px, calc(100vw - 24px));
      padding: 10px 12px; border-radius: 10px; background: #1f1f1f; color: #f2f2f2; box-shadow: 0 6px 24px #0005;
      font: 13px/1.45 system-ui, sans-serif; }
    #gotp * { all: revert; font: inherit; color: inherit; box-sizing: border-box; }
    #gotp .gotp-code { font: 700 22px/1.2 ui-monospace, monospace; letter-spacing: 2px; margin: 4px 0; user-select: all; }
    #gotp .gotp-sub { opacity: .7; font-size: 12px; }
    #gotp .gotp-warn { color: #ffb74d; font-size: 12px; margin-top: 4px; }
    #gotp .gotp-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    #gotp button { padding: 4px 10px; border: 1px solid #fff4; border-radius: 6px; background: #fff1; cursor: pointer; }
    #gotp button.gotp-main { background: #1a73e8; border-color: #1a73e8; color: #fff; }
    #gotp .gotp-x { position: absolute; top: 4px; right: 6px; border: 0; background: none; opacity: .6; padding: 0 4px; }
  `;
  let styled = false;
  function show(...kids) {
    if (!styled) { GM_addStyle(CSS); styled = true; }
    if (ui) ui.remove();
    ui = h('div', { id: 'gotp', role: 'status' },
      h('button', { class: 'gotp-x', title: 'Close', onclick: () => { ui.remove(); ui = null; } }, '✕'), ...kids);
    document.documentElement.append(ui);
  }
  const btn = (label, onclick, main) => h('button', { type: 'button', class: main ? 'gotp-main' : null, onclick }, label);

  function offer() {
    show(h('div', {}, '📩 This page wants a code.'),
      h('div', { class: 'gotp-btns' }, btn('Get code from Gmail', ask, true)));
  }

  // ── Request / result ──
  // Gmail's Atom feed: the unread inbox as a small XML list (sender, subject,
  // preview, time), served with the browser's own Gmail cookies. No tab, no
  // rendering — answers in about a second.
  function readFeed(account) {
    return new Promise(resolve => GM_xmlhttpRequest({
      method: 'GET', url: `https://mail.google.com/mail/u/${account}/feed/atom?_=${Date.now()}`, timeout: 10000,
      onload: r => resolve(r.status === 200 && /<feed[\s>]/.test(r.responseText) ? r.responseText : null),
      onerror: () => resolve(null), ontimeout: () => resolve(null),
    }));
  }

  const unescapeXML = t => t.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (_, e) =>
    ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e.toLowerCase()]
    || String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));

  function feedEntries(xml) {
    const tag = (e, n) => { const m = e.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)); return m ? unescapeXML(m[1]).trim() : ''; };
    return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => ({
      subject: tag(e, 'title'), summary: tag(e, 'summary'),
      from: tag(e, 'email') || tag(e, 'name'), time: Date.parse(tag(e, 'issued') || tag(e, 'modified')),
    }));
  }

  async function pollFeed(req, isCurrent) {
    const startedAt = Date.now();
    while (isCurrent()) {
      const xml = await readFeed(settings().account);
      if (!isCurrent()) return;
      if (!xml) return openGmailTab(req, 'Gmail feed unavailable — reading Gmail itself instead.');
      for (const e of feedEntries(xml)) {
        const text = e.subject + ' ' + e.summary;
        if (!(e.time >= req.since)) {
          // Old mail. If its conversation gets a new mail later, the feed
          // bumps the time but may keep this old preview: remember its code.
          const old = extractCode(text, req.len, req.skip);
          if (old) req.skip.push(old);
          continue;
        }
        const code = extractCode(text, req.len, req.skip);
        if (code) return done({ id: req.id, code, from: e.from, subject: e.subject });
      }
      // Feed works but nothing yet: the mail may still be on its way, or
      // already read, or its code below the preview. After a while, let
      // the Gmail tab look too (it also opens mails); keep polling anyway.
      if (!tabTried && Date.now() - startedAt > FEED_ALONE_MS) openGmailTab(req, 'Not in the unread previews yet — also checking Gmail itself.');
      await new Promise(r => setTimeout(r, FEED_POLL_MS));
    }
  }

  // ?monk=lite: if monk.js is installed, Gmail loads without images, fonts
  // and third-party scripts. Without monk it's simply ignored.
  const gmailURL = () => `https://mail.google.com/mail/u/${settings().account}/?monk=lite#search/` + encodeURIComponent(SEARCH);
  let tabTried = false;

  // Opened in front: Chrome doesn't let a hidden tab draw Gmail's mail list.
  // Closing it (when the code is found) returns you to this page.
  function openGmailTab(req, note) {
    if (tabTried) return;
    tabTried = true;
    GM_setValue(REQ_KEY, { ...req, at: Date.now() });   // the tab must load after this
    if (settings().beside) return openBeside(note);
    tab = GM_openInTab(gmailURL(), { active: true, insert: true, setParent: true });
    if (note) status(note);
  }

  // Experimental: Gmail in a narrow window beside the page instead of a tab.
  // It's on screen, so Chrome draws it, and you never leave your page.
  // (Browsers' own split view can't be opened by a script.) Popups need a
  // recent click; without one, a button supplies it.
  function openBeside(note) {
    const w = Math.min(520, Math.round(screen.availWidth / 3));
    const win = window.open(gmailURL(), 'gotp-gmail', `popup,width=${w},height=${screen.availHeight},`
      + `left=${(screen.availLeft || 0) + screen.availWidth - w},top=${screen.availTop || 0}`);
    if (win) {
      tab = { close: () => win.close() };
      status((note ? note + ' ' : '') + 'Gmail is open beside this page.');
    } else {
      status(note, btn('Open Gmail beside ↗', () => openBeside(note), true));
    }
  }

  let current = null;   // id of the request in flight
  function status(note, ...extra) {
    show(h('div', {}, '⏳ Looking in Gmail for the code…'),
      note && h('div', { class: 'gotp-sub' }, note),
      h('div', { class: 'gotp-btns' }, ...extra, btn('Cancel', () => done(null, 'Cancelled.'))));
  }

  function ask() {
    asked = true;
    const id = Math.random().toString(36).slice(2);
    current = id;
    tabTried = false;
    const used = GM_getValue(USED_KEY, []).filter(u => Date.now() - u.at < 864e5);
    const req = { id, at: Date.now(), since: (boxSeenAt || Date.now()) - LOOKBACK_MS, len: target ? target.len : 0,
      host: location.hostname, skip: used.map(u => u.code) };
    GM_setValue(REQ_KEY, req);
    status('Reading your unread mail…');
    clearTimeout(timer);
    timer = setTimeout(() => done(null, 'No code found in Gmail within 3 minutes.'), WAIT_MS);

    const listener = GM_addValueChangeListener(RES_KEY, (_, __, res) => {
      if (res && res.id === id) { GM_removeValueChangeListener(listener); done(res); }
    });
    pollFeed(req, () => current === id);
  }

  function done(res, failMsg) {
    if (!current || (res && res.id !== current)) return;   // already answered
    current = null;
    clearTimeout(timer);
    const req = GM_getValue(REQ_KEY, null);
    if (req && !req.done) GM_setValue(REQ_KEY, { ...req, done: true });
    try { if (tab && !tab.closed) tab.close(); } catch {}
    tab = null;
    if (!res) {
      show(h('div', {}, failMsg), h('div', { class: 'gotp-btns' }, btn('Try again', ask, true)));
      return;
    }
    GM_setValue(USED_KEY, [{ code: res.code, at: Date.now() },
      ...GM_getValue(USED_KEY, []).filter(u => Date.now() - u.at < 864e5)].slice(0, 50));
    const fromDomain = (res.from.split('@')[1] || '').toLowerCase();
    const trusted = fromDomain && brand(fromDomain) === brand(location.hostname);
    if (trusted && settings().autoFill) {
      show(h('div', {}, '⏳ Filling in ' + res.code + '…'));
      fill(res.code).then(ok => result(res, trusted, fromDomain, ok ? 'filled' : 'failed'));
    } else result(res, trusted, fromDomain, null);
  }

  function result(res, trusted, fromDomain, outcome) {
    if (outcome === 'filled') filledCode = res.code;
    show(
      h('div', {}, outcome === 'filled' ? '✅ Filled in the code'
        : outcome === 'failed' ? '⚠ Couldn\'t fill the boxes — copy and paste it' : '📩 Code from Gmail'),
      h('div', { class: 'gotp-code' }, res.code),
      h('div', { class: 'gotp-sub' }, `${res.from}${res.subject ? ' — ' + res.subject : ''}`),
      !trusted && h('div', { class: 'gotp-warn' },
        `⚠ Sent by ${fromDomain || 'an unknown sender'}, not ${location.hostname}. Fill only if you expected it.`),
      h('div', { class: 'gotp-btns' },
        outcome !== 'filled' && btn('Fill', e => {
          e.target.textContent = 'Filling…';
          fill(res.code).then(ok => { if (ok) { filledCode = res.code; ui.remove(); } else e.target.textContent = 'Didn\'t take — Copy instead'; });
        }, true),
        btn('Copy', e => { GM_setClipboard(res.code); e.target.textContent = 'Copied'; })));
  }

  // ── Watch the page ──
  function check() {
    if (!document.body) return;
    const t = findTarget();
    if (!t) return;
    // Wrong code or "resend": the page empties the boxes we filled.
    if (asked && !current && filledCode && t.els.every(e => !e.value)) {
      filledCode = null;
      asked = false;
      target = t;
      boxSeenAt = Date.now();
      show(h('div', {}, '📩 The code boxes were cleared.'),
        h('div', { class: 'gotp-btns' }, btn('Get the new code from Gmail', ask, true)));
      return;
    }
    if (asked) return;
    const first = !target;
    target = t;
    if (!first) return;
    boxSeenAt = Date.now();
    const viaEmail = SAYS_EMAIL.test(t.pageText) && !SAYS_PHONE.test(t.pageText);
    if (t.strong && viaEmail && settings().autoFetch) ask();
    else offer();
  }

  GM_registerMenuCommand('Gmail OTP: get code now', ask);
  GM_registerMenuCommand(`Gmail OTP: auto-fetch ${settings().autoFetch ? 'ON → turn off' : 'OFF → turn on'}`,
    () => saveSettings({ autoFetch: !settings().autoFetch }));
  GM_registerMenuCommand(`Gmail OTP: auto-fill from matching sender ${settings().autoFill ? 'ON → turn off' : 'OFF → turn on'}`,
    () => saveSettings({ autoFill: !settings().autoFill }));
  GM_registerMenuCommand(`Gmail OTP: (experimental) Gmail beside the page ${settings().beside ? 'ON → turn off' : 'OFF → turn on'}`,
    () => saveSettings({ beside: !settings().beside }));
  GM_registerMenuCommand(`Gmail OTP: Gmail account u/${settings().account}`, () => {
    const n = prompt('Which Gmail account? (0 = first signed-in account, 1 = second, …)', settings().account);
    if (n !== null && /^\d+$/.test(n.trim())) saveSettings({ account: +n.trim() });
  });

  check();
  let pending = false;
  new MutationObserver(() => {
    if (pending || (asked && !filledCode)) return;
    pending = true;
    setTimeout(() => { pending = false; check(); }, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
