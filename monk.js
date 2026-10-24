/*
 * File: monk.js
 * Author: vididvidid
 * Created: 2026-10-24
 *
 * versions:
 *
 * 0.2.0          Lite runs only the site's own JavaScript: third-party
 *                scripts (ads, analytics, trackers, chat widgets) are
 *                blocked; library CDNs, captchas, sign-in and payment still
 *                load. Static notices pages that need JavaScript (Gmail, a
 *                page that draws its list from JSON, an empty React root)
 *                and reopens them in Lite — remembered per site. Page CSS
 *                that got in before monk started is taken out by hand, and
 *                the panel warns when Tampermonkey injected monk late
 *
 * 0.1.0          any website, loaded the minimal way for slow internet.
 *                Lite: the site works, but images, video, web fonts and
 *                third-party frames are not downloaded. Static: no
 *                JavaScript, no CSS — just the HTML, like Gmail's old basic
 *                view; YouTube gets its own static page built from the data
 *                already in the HTML (search, lists, watch page). Per-site
 *                mode, a global default (or Auto by connection speed), and
 *                click-to-load for single images
 */

/**
 * ============================================================================
 * HOW IT WORKS
 * ============================================================================
 * A userscript can't intercept requests, but it runs at document-start —
 * before the page's own <head> is parsed — and a Content-Security-Policy
 * <meta> put into the head at that moment is enforced by the browser for
 * everything the page loads afterwards. So every mode is mostly one CSP line:
 *
 *   lite     img-src data: blob:      images are never fetched
 *            media-src 'none'         video / audio never fetched
 *            font-src data:           no web fonts (icon fonts show as words)
 *            frame-src 'self' + …     no ads / embeds; logins, captchas and
 *                                     payment frames are let through
 *            script-src own site + …  only the site's own JavaScript runs
 *                                     (plus library CDNs, captchas, sign-in,
 *                                     payment); ads and trackers don't.
 *            Animations and transitions are switched off.
 *
 *   static   all of lite, plus
 *            script-src 'none'        no JavaScript at all
 *            style-src 'nonce-…'      no page CSS; only monk's own small
 *                                     readable stylesheet carries the nonce
 *            Links and forms are plain HTML, so every click is one small
 *            page load — exactly what "basic HTML" mode used to be.
 *            <noscript> fallbacks are shown, images become "🖼 alt"
 *            placeholders (click one to load just that image).
 *
 *   YouTube  in static mode the page is rebuilt from ytInitialData /
 *            ytInitialPlayerResponse, which YouTube puts in the HTML: a search
 *            box, the video list (home, search, channel, playlist, related)
 *            and, on a watch page, title, channel, description and a
 *            "Play here" button that reopens the page once in Lite at 144p.
 *            Lite mode on YouTube allows video and forces 144p.
 *
 * Images that the user does ask for are fetched with GM_xmlhttpRequest and put
 * in as data: URLs — the CSP lets data: through, so nothing has to be loosened.
 *
 * The CSP can only ever be stricter than the site's own, never looser. Things
 * the browser starts fetching before the script runs (HTTP Link preloads, the
 * very first bytes the preload scanner sees) may still come through.
 *
 * Settings live in Tampermonkey storage: { def, sites: { host: { mode, allow } } }.
 * "Once" overrides (Full page once, Play here) go through sessionStorage and
 * apply to the next load of this tab only.
 */

// ==UserScript==
// @name         monk – minimal web
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.2.0
// @description  Loads any website the minimal way for slow internet: Lite (no images/video/fonts) or Static (no JS/CSS, like Gmail's old basic HTML)
// @author       vididvidid
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  if (document.contentType && document.contentType !== 'text/html') return;

  // ── 1. Config ─────────────────────────────────────────────────────────────
  const STORE_KEY = 'monk';
  const ONCE_KEY = 'monk-once';
  const MODE_LABEL = { off: 'Off', lite: 'Lite', static: 'Static', auto: 'Auto' };
  const ALLOW_LABEL = {
    img: 'Images', media: 'Video & audio', font: 'Web fonts',
    frame: 'Third-party frames', script: 'Third-party scripts',
  };
  const SITE_PRESETS = {
    'youtube.com': { allow: { media: true } },
  };
  // Frames Lite still lets through, so logging in and paying keep working.
  const FRAME_OK = [
    'https://www.google.com', 'https://www.recaptcha.net', 'https://accounts.google.com',
    'https://*.hcaptcha.com', 'https://challenges.cloudflare.com',
    'https://*.stripe.com', 'https://*.paypal.com', 'https://appleid.apple.com',
    'https://*.facebook.com', 'https://login.microsoftonline.com',
  ];
  // Lite runs the site's own JavaScript only. These count as "own" for a site
  // because its code lives there too.
  const SIBLINGS = {
    'google.com': ['gstatic.com', 'googleapis.com', 'googleusercontent.com'],
    'youtube.com': ['google.com', 'gstatic.com', 'googleapis.com', 'ytimg.com', 'ggpht.com', 'googlevideo.com'],
    'facebook.com': ['fbcdn.net', 'facebook.net'],
    'instagram.com': ['cdninstagram.com', 'fbcdn.net', 'facebook.net'],
    'whatsapp.com': ['whatsapp.net', 'fbcdn.net'],
    'x.com': ['twimg.com', 'twitter.com'],
    'twitter.com': ['twimg.com', 'x.com'],
    'github.com': ['githubassets.com', 'githubusercontent.com'],
    'reddit.com': ['redditstatic.com', 'redditmedia.com'],
    'linkedin.com': ['licdn.com'],
    'live.com': ['microsoft.com', 'office.com', 'office.net', 'msauth.net', 'msftauth.net', 'live.net'],
    'office.com': ['microsoft.com', 'office.net', 'live.com', 'msauth.net', 'msftauth.net'],
    'amazon.in': ['media-amazon.com', 'ssl-images-amazon.com', 'amazon.com'],
    'amazon.com': ['media-amazon.com', 'ssl-images-amazon.com'],
    'wikipedia.org': ['wikimedia.org'],
    'stackoverflow.com': ['sstatic.net'],
    'chatgpt.com': ['oaistatic.com', 'openai.com'],
  };
  // Scripts any site may still load in Lite: public library CDNs (not
  // trackers), captchas, sign-in and payment.
  const SCRIPT_OK = [
    'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com',
    'https://ajax.googleapis.com', 'https://code.jquery.com', 'https://esm.sh',
    'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://www.recaptcha.net',
    'https://*.hcaptcha.com', 'https://challenges.cloudflare.com',
    'https://accounts.google.com', 'https://apis.google.com',
    'https://js.stripe.com', 'https://*.paypal.com', 'https://checkout.razorpay.com',
  ];
  const THIN_PAGE_CHARS = 200;     // static page with less visible text than this → "needs JS" notice
  const MAX_IMAGES = 60;           // "Load images here" stops after this many

  const host = location.hostname.replace(/^www\./, '');
  const isYouTube = /^(www\.)?youtube\.com$/.test(location.hostname);
  // Registrable domain, near enough: mail.google.com → google.com, bbc.co.uk → bbc.co.uk.
  const site = (() => {
    const p = location.hostname.split('.');
    if (p.length < 3 || /^[\d.]+$|:/.test(location.hostname)) return location.hostname;
    return p.slice(/^(co|com|org|net|gov|ac|edu|gen|nic)$/.test(p[p.length - 2]) ? -3 : -2).join('.');
  })();

  // ── 2. Settings ───────────────────────────────────────────────────────────
  function load() {
    const s = GM_getValue(STORE_KEY, null) || {};
    return { def: s.def || 'lite', sites: s.sites || {} };
  }
  let store = load();
  const save = () => GM_setValue(STORE_KEY, store);

  function siteCfg() {
    const preset = Object.entries(SITE_PRESETS).find(([d]) => host === d || host.endsWith('.' + d));
    const user = store.sites[host] || {};
    return {
      mode: user.mode || 'default',
      needsJS: !!user.needsJS,
      allow: { img: false, media: false, font: false, frame: false, script: false, ...(preset && preset[1].allow), ...user.allow },
    };
  }

  function setSite(patch) {
    store = load();
    const s = store.sites[host] || {};
    if (patch.mode === 'default') delete s.mode;
    else if (patch.mode) s.mode = patch.mode;
    if (patch.allow) s.allow = { ...s.allow, ...patch.allow };
    if ('needsJS' in patch) { if (patch.needsJS) s.needsJS = true; else delete s.needsJS; }
    if (Object.keys(s).length) store.sites[host] = s;
    else delete store.sites[host];
    save();
  }

  function reloadOnce(o) {
    try { sessionStorage.setItem(ONCE_KEY, JSON.stringify(o)); } catch {}
    location.reload();
  }

  function autoMode() {
    const c = navigator.connection;
    if (!c) return 'lite';
    if (c.saveData || /2g/.test(c.effectiveType)) return 'static';
    return c.effectiveType === '3g' ? 'lite' : 'off';
  }

  let once = null;
  try {
    once = JSON.parse(sessionStorage.getItem(ONCE_KEY));
    sessionStorage.removeItem(ONCE_KEY);
  } catch {}

  const cfg = siteCfg();
  const chosen = (once && once.mode) || (cfg.mode !== 'default' ? cfg.mode : store.def);
  let mode = chosen === 'auto' ? autoMode() : chosen;
  // A site monk has seen break without JavaScript gets Lite instead of Static,
  // unless Static was picked for it on purpose.
  const explicitStatic = (once && once.mode === 'static') || (!once && cfg.mode === 'static');
  if (mode === 'static' && cfg.needsJS && !explicitStatic) mode = 'lite';
  const allow = { ...cfg.allow, ...(once && once.allow) };
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ── 3. Content-Security-Policy ────────────────────────────────────────────
  function policy() {
    const d = [];
    if (mode === 'static') {
      d.push("script-src 'none'", `style-src 'nonce-${nonce}'`, "worker-src 'none'",
        "object-src 'none'", "manifest-src 'none'", "connect-src 'none'");
    }
    if (!allow.img) d.push('img-src data: blob:');
    if (!allow.media) d.push("media-src 'none'");
    if (!allow.font) d.push('font-src data:');
    if (!allow.frame) d.push(mode === 'static' ? "frame-src 'none'" : "frame-src 'self' " + FRAME_OK.join(' '));
    if (mode === 'lite' && !allow.script) {
      const own = [site, ...(SIBLINGS[site] || [])].flatMap(d => [`https://${d}`, `https://*.${d}`]);
      d.push(["script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:", ...own, ...SCRIPT_OK].join(' '));
    }
    return d.join('; ');
  }

  // Chrome only honours a CSP <meta> inside document.head. At document-start
  // the parser usually hasn't made one yet, so make it ourselves: it becomes
  // the first <head> and the parser's own one simply follows it.
  function injectCSP() {
    const root = document.documentElement;
    let head = document.head;
    if (!head) { head = document.createElement('head'); root.prepend(head); }
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy();
    head.prepend(meta);
  }

  // ── 4. Small helpers ──────────────────────────────────────────────────────
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
  const btn = (label, onclick) => h('button', { type: 'button', class: 'monk-btn', onclick }, label);

  // In static mode the page's CSP only lets in <style> carrying our nonce;
  // GM_addStyle covers lite/off and any site whose own CSP rejects the nonce.
  function addStyle(css) {
    try {
      const el = GM_addStyle(css);
      if (el && el.setAttribute) el.setAttribute('data-monk', '');
    } catch {}
    if (mode === 'static') {
      const s = document.createElement('style');
      s.setAttribute('data-monk', '');
      s.setAttribute('nonce', nonce);
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  }

  function fetchDataURL(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', timeout: 30000,
        onload: r => {
          if (r.status >= 400 || !r.response) return reject(new Error('HTTP ' + r.status));
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(r.response);
        },
        onerror: reject, ontimeout: reject,
      });
    });
  }

  // ── 5. Images on demand ───────────────────────────────────────────────────
  function smallestFromSrcset(set) {
    let best = null, bestW = Infinity;
    for (const cand of set.split(/,\s+/)) {
      const [url, desc = ''] = cand.trim().split(/\s+/);
      const w = parseFloat(desc) || 0;
      if (!best || w < bestW) { best = url; bestW = w; }
    }
    return best || '';
  }

  function imgSource(img) {
    const a = n => img.getAttribute(n) || '';
    let src = a('data-src') || a('data-lazy-src') || a('data-original') || a('src');
    const set = a('srcset') || a('data-srcset');
    if ((!src || src.startsWith('data:')) && set) src = smallestFromSrcset(set);
    if (!src || src.startsWith('data:')) return '';
    try { return new URL(src, document.baseURI).href; } catch { return ''; }
  }

  async function loadImage(img) {
    const url = imgSource(img);
    if (!url) return;
    img.src = await fetchDataURL(url);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('loading');
    if (img.parentElement && img.parentElement.tagName === 'PICTURE') {
      img.parentElement.querySelectorAll('source').forEach(s => s.remove());
    }
    img.setAttribute('data-monk-ok', '');
    const ph = img.previousElementSibling;
    if (ph && ph.classList.contains('monk-ph')) ph.remove();
  }

  async function loadAllImages() {
    const imgs = [...document.images]
      .filter(i => !i.hasAttribute('data-monk-ok') && (mode === 'static' || !i.complete || !i.naturalWidth))
      .slice(0, MAX_IMAGES);
    const queue = imgs.slice();
    const worker = async () => { while (queue.length) await loadImage(queue.shift()).catch(() => {}); };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  function placeholders() {
    for (const img of [...document.images]) {
      const w = +img.getAttribute('width'), ht = +img.getAttribute('height');
      if ((w && w <= 2) || (ht && ht <= 2)) { img.remove(); continue; }   // tracking pixel
      if (img.src.startsWith('data:') && !img.hasAttribute('data-src')) {    // already inline
        img.setAttribute('data-monk-ok', '');
        continue;
      }
      const url = imgSource(img);
      if (!url) continue;
      const alt = (img.getAttribute('alt') || '').trim();
      const ph = h('span', { class: 'monk-ph', title: 'Load ' + url }, '🖼 ' + (alt || 'image'));
      ph.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        ph.textContent = '⏳ ' + (alt || 'image');
        loadImage(img).catch(() => { ph.textContent = '⚠ ' + (alt || 'image') + ' (failed)'; });
      });
      img.before(ph);
    }
  }

  // ── 6. Static mode clean-up ───────────────────────────────────────────────
  let ttPolicy = null;
  function parseHTML(html) {
    let markup = html;
    try {
      if (window.trustedTypes) {
        ttPolicy = ttPolicy || trustedTypes.createPolicy('monk', { createHTML: s => s });
        markup = ttPolicy.createHTML(html);
      }
    } catch {}
    try { return new DOMParser().parseFromString(markup, 'text/html').body; } catch { return null; }
  }

  // With scripting on (it is — CSP only blocks it), <noscript> holds its HTML
  // as plain text. Parse it and put it in place. Meta/link/style are dropped:
  // a <noscript><meta http-equiv=refresh> would bounce to an "enable JS" page.
  let jsWarning = false;   // a <noscript> says "turn on JavaScript"
  function unwrapNoscript() {
    for (const ns of [...document.querySelectorAll('body noscript')]) {
      if (/javascript/i.test(ns.textContent.replace(/<[^>]*>/g, ''))) jsWarning = true;
      const body = parseHTML(ns.textContent);
      if (!body) continue;
      body.querySelectorAll('meta, link, style, script, noscript').forEach(n => n.remove());
      ns.replaceWith(...[...body.childNodes].map(n => document.adoptNode(n)));
    }
  }

  // Inline style="" is blocked too, so things the page meant to start hidden
  // (menus, dialogs) would all show. Keep those hidden.
  function hideInlineHidden() {
    for (const el of document.querySelectorAll('[style]')) {
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style'))) {
        el.setAttribute('data-monk-hide', '');
      }
      el.removeAttribute('style');
    }
  }

  // When Tampermonkey starts us after part of the page was already parsed,
  // the CSP came too late for what was above it. Take that CSS out by hand.
  function stripPageCSS() {
    document.querySelectorAll('link[rel~="stylesheet" i], style:not([data-monk])').forEach(n => n.remove());
    try { document.adoptedStyleSheets = []; } catch {}
  }

  // Pages that are nothing without JavaScript: web apps (Gmail), pages that
  // ship their data as JSON for a script to draw (a dashboard's job list), or
  // an empty React / Vue / Next root.
  function needsJS() {
    const text = document.body ? document.body.innerText.trim().length : 0;
    if (text < THIN_PAGE_CHARS) return true;
    if (jsWarning && text < 1500) return true;
    const root = document.querySelector('#root, #app, #__next, #__nuxt, #___gatsby, #svelte, app-root, [ng-version], [data-reactroot]');
    if (root && root.innerText.trim().length < 50) return true;
    const data = [...document.querySelectorAll('script[type="application/json"]')]
      .reduce((n, sc) => n + sc.textContent.length, 0);
    return data > 2000 && data > text * 4;   // far more data than what's shown
  }

  function jsNotice() {
    if (!document.body) return;
    document.body.prepend(h('div', { id: 'monk-notice' },
      h('b', {}, 'monk: '), 'this page needs JavaScript to show its content. ',
      btn('Open in Lite once', () => reloadOnce({ mode: 'lite' })), ' ',
      btn('Always Lite here', () => { setSite({ mode: 'lite' }); location.reload(); }), ' ',
      btn('Full page once', () => reloadOnce({ mode: 'off' }))));
  }

  function staticPass() {
    stripPageCSS();
    unwrapNoscript();
    hideInlineHidden();
    if (isYouTube && renderYouTube()) return;
    if (!allow.img) placeholders();
    if (!needsJS()) return;
    if (explicitStatic) return jsNotice();
    // Static only came from the default: remember the site needs JS and
    // reopen it in Lite, which runs the site's own scripts.
    setSite({ needsJS: true });
    reloadOnce({ mode: 'lite', note: 'needsJS' });
  }

  // ── 7. YouTube, static ────────────────────────────────────────────────────
  // The scripts are blocked, but their text is still in the DOM.
  function matchBrace(t, i) {
    let depth = 0, inStr = false;
    for (; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return -1;
  }

  function extractJSON(name) {
    // Newer pages: <script id="yt-initial-data" type="application/json">
    const el = document.getElementById(name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
    if (el) try { return JSON.parse(el.textContent); } catch {}
    const re = new RegExp(name + '"?\\]?\\s*=\\s*\\{');
    for (const s of document.scripts) {
      const t = s.textContent;
      const m = re.exec(t);
      if (!m) continue;
      const start = m.index + m[0].length - 1;
      const end = matchBrace(t, start);
      if (end < 0) continue;
      try { return JSON.parse(t.slice(start, end + 1)); } catch {}
    }
    return null;
  }

  const txt = o => !o ? '' : typeof o === 'string' ? o
    : o.simpleText || o.content || (o.runs || []).map(r => r.text).join('');

  function videoFrom(key, v) {
    switch (key) {
      case 'videoRenderer': case 'compactVideoRenderer': case 'gridVideoRenderer':
      case 'playlistVideoRenderer': case 'playlistPanelVideoRenderer':
        return v.videoId && {
          id: v.videoId, title: txt(v.title),
          by: txt(v.ownerText || v.shortBylineText || v.longBylineText),
          len: txt(v.lengthText),
          meta: [txt(v.viewCountText) || txt(v.shortViewCountText), txt(v.publishedTimeText)].filter(Boolean).join(' · '),
        };
      case 'reelItemRenderer':
        return v.videoId && { id: v.videoId, kind: 'short', title: txt(v.headline), meta: txt(v.viewCountText) };
      case 'shortsLockupViewModel': {
        const om = v.overlayMetadata || {};
        const ep = v.onTap && v.onTap.innertubeCommand && v.onTap.innertubeCommand.reelWatchEndpoint;
        const id = (ep && ep.videoId) || (v.entityId || '').replace(/^shorts-shelf-item-/, '');
        return id && { id, kind: 'short', title: txt(om.primaryText), meta: txt(om.secondaryText) };
      }
      case 'lockupViewModel': {
        const kind = v.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? 'playlist'
          : !v.contentType || v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? 'video' : null;
        const md = v.metadata && v.metadata.lockupMetadataViewModel;
        if (!kind || !md || !v.contentId) return null;
        const cm = md.metadata && md.metadata.contentMetadataViewModel;
        const parts = ((cm && cm.metadataRows) || []).map(r =>
          (r.metadataParts || []).map(p => txt(p.text)).filter(Boolean).join(' · '));
        return { id: v.contentId, kind, title: txt(md.title), by: parts[0] || '', meta: parts.slice(1).join(' · ') };
      }
    }
    return null;
  }

  function collectVideos(root) {
    const out = [], seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      for (const [k, v] of Object.entries(o)) {
        if (!v || typeof v !== 'object') continue;
        const vid = videoFrom(k, v);
        if (vid) {
          if (!seen.has(vid.id)) { seen.add(vid.id); out.push(vid); }
        } else walk(v);
      }
    })(root);
    return out;
  }

  function fmtLen(sec) {
    const s = +sec, hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    const p = n => String(n).padStart(2, '0');
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  }

  function linkify(text) {
    const out = [], re = /https?:\/\/[^\s<>"]+/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index), h('a', { href: m[0], rel: 'noopener' }, m[0]));
      last = re.lastIndex;
    }
    out.push(text.slice(last));
    return out;
  }

  function watchSection(vd) {
    const thumb = h('div', {});
    const showThumb = async e => {
      e.target.disabled = true;
      try {
        const img = h('img', { alt: '', 'data-monk-ok': true, class: 'monk-thumb' });
        img.src = await fetchDataURL(`https://i.ytimg.com/vi/${vd.videoId}/mqdefault.jpg`);
        thumb.replaceChildren(img);
      } catch { e.target.disabled = false; }
    };
    return h('section', {},
      h('h1', {}, vd.title),
      h('p', { class: 'monk-meta' },
        h('a', { href: '/channel/' + vd.channelId }, vd.author),
        vd.viewCount && ` · ${Number(vd.viewCount).toLocaleString()} views`,
        +vd.lengthSeconds ? ` · ${fmtLen(vd.lengthSeconds)}` : '',
        vd.isLiveContent ? ' · live' : ''),
      h('p', {},
        btn('▶ Play here (Lite, 144p)', () => reloadOnce({ mode: 'lite', allow: { media: true } })), ' ',
        btn('Full page once', () => reloadOnce({ mode: 'off' })), ' ',
        btn('Show thumbnail', showThumb)),
      thumb,
      h('details', { open: (vd.shortDescription || '').length < 400 }, h('summary', {}, 'Description'),
        h('div', { class: 'monk-desc' }, linkify(vd.shortDescription || ''))));
  }

  function renderYouTube() {
    const data = extractJSON('ytInitialData');
    const player = extractJSON('ytInitialPlayerResponse');
    if (!data && !player) return false;
    const vd = player && player.videoDetails;
    const q = new URLSearchParams(location.search).get('search_query') || '';

    const search = h('form', { action: '/results', method: 'get', class: 'monk-search' },
      h('a', { href: '/' }, 'YouTube'), ' ',
      h('input', { type: 'search', name: 'search_query', value: q, placeholder: 'Search' }), ' ',
      h('button', { type: 'submit' }, 'Search'));

    const md = data && data.metadata && data.metadata.channelMetadataRenderer;
    const heading = vd ? watchSection(vd)
      : h('h1', {}, (md && md.title) || (q && `Results for “${q}”`) || document.title);

    const vids = collectVideos(data && (data.contents || data)).filter(v => !vd || v.id !== vd.videoId);
    const href = v => v.kind === 'playlist' ? '/playlist?list=' + v.id
      : v.kind === 'short' ? '/shorts/' + v.id : '/watch?v=' + v.id;
    const list = vids.length
      ? h('ol', { class: 'monk-list' }, vids.map(v => h('li', {},
          h('a', { href: href(v) }, v.title || v.id),
          v.len && ` [${v.len}]`, v.kind !== 'video' && v.kind && ` [${v.kind}]`,
          h('div', { class: 'monk-meta' }, [v.by, v.meta].filter(Boolean).join(' · ')))))
      : h('p', { class: 'monk-meta' }, vd ? '' : 'Nothing listed in this page. Signed out, YouTube\'s home feed is empty — try a search.');

    document.body.replaceChildren(h('main', { id: 'monk-yt' },
      search, heading, vd && vids.length ? h('h2', {}, 'Up next') : null, list));
    return true;
  }

  // ── 8. Styles ─────────────────────────────────────────────────────────────
  const LITE_CSS = `
    *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  `;

  const HIDE = [
    '[data-monk-hide]',
    ...(allow.img ? [] : ['img:not([data-monk-ok])', 'picture source']),
    ...(allow.media ? [] : ['video', 'audio']),
    ...(allow.frame ? [] : ['iframe', 'embed', 'object']),
  ].join(', ');

  const STATIC_CSS = `
    html { color-scheme: light dark; }
    body { max-width: 52rem; margin: 0 auto !important; padding: 1rem 1rem 4rem; font: 16px/1.55 system-ui, sans-serif; overflow-wrap: anywhere; }
    ${HIDE} { display: none !important; }
    svg { max-width: 1.5em; max-height: 1.5em; }
    img { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; }
    table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    td, th { border: 1px solid #8884; padding: .2em .4em; }
    input, select, textarea, button { font: inherit; max-width: 100%; }
    .monk-ph { display: inline-block; margin: 1px 2px; padding: 0 .4em; border: 1px dashed #8888; border-radius: 4px; font-size: .85em; cursor: pointer; opacity: .8; }
    .monk-ph:hover { opacity: 1; }
    #monk-notice { margin: 0 0 1rem; padding: .6rem .8rem; border: 1px solid #c90; border-radius: 6px; background: #fc02; }
    #monk-yt .monk-search { display: flex; gap: .4rem; align-items: center; margin-bottom: 1rem; }
    #monk-yt .monk-search input { flex: 1; min-width: 0; }
    #monk-yt .monk-list li { margin: .5rem 0; }
    #monk-yt .monk-meta { opacity: .7; font-size: .9em; }
    #monk-yt .monk-desc { white-space: pre-wrap; }
    #monk-yt .monk-thumb { display: block; margin: .5rem 0; max-width: 320px; }
  `;

  const UI_CSS = `
    #monk-pill { all: initial; position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; padding: 5px 9px; border-radius: 999px;
      background: #222; color: #fff; font: 600 11px/1 system-ui, sans-serif; opacity: .5; cursor: pointer; }
    #monk-pill:hover, #monk-pill:focus-visible { opacity: 1; }
    #monk-panel { all: initial; position: fixed; left: 8px; bottom: 36px; z-index: 2147483647; box-sizing: border-box;
      width: min(310px, calc(100vw - 16px)); max-height: calc(100vh - 48px); overflow: auto; padding: 12px 14px; border-radius: 10px;
      background: #fff; color: #111; box-shadow: 0 6px 24px #0005; font: 13px/1.45 system-ui, sans-serif; }
    #monk-panel * { all: revert; font: inherit; color: inherit; box-sizing: border-box; }
    #monk-panel .monk-h { display: flex; gap: 6px; align-items: baseline; margin-bottom: 6px; }
    #monk-panel .monk-now { margin-left: auto; opacity: .6; font-size: 11px; }
    #monk-panel .monk-sec { margin: 10px 0 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: .6; }
    #monk-panel .monk-row { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    #monk-panel .monk-col { display: grid; gap: 2px; }
    #monk-panel label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
    #monk-panel .monk-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    #monk-panel .monk-btn, #monk-panel select { padding: 3px 8px; border: 1px solid #8886; border-radius: 6px; background: transparent; cursor: pointer; }
    #monk-panel .monk-hint { margin: 10px 0 0; font-size: 11px; opacity: .65; }
    #monk-panel .monk-warn { margin: 0 0 8px; padding: 6px 8px; border-radius: 6px; background: #f902; font-size: 11px; }
    #monk-toast { all: initial; position: fixed; left: 8px; bottom: 36px; z-index: 2147483647; max-width: min(340px, calc(100vw - 16px));
      padding: 8px 10px; border-radius: 8px; background: #222; color: #fff; font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px #0004; }
    #monk-toast button { all: revert; margin-left: 6px; font: inherit; cursor: pointer; }
    @media (prefers-color-scheme: dark) {
      #monk-panel { background: #1f1f1f; color: #eee; }
      #monk-pill { background: #eee; color: #111; }
    }
  `;

  // ── 9. Panel ──────────────────────────────────────────────────────────────
  let panel = null, pill = null, uiStyled = false;

  function ensureUIStyle() {
    if (uiStyled) return;
    uiStyled = true;
    addStyle(UI_CSS);
  }

  function buildPanel() {
    const c = siteCfg();
    const radios = ['default', 'off', 'lite', 'static'].map(m => h('label', {},
      h('input', { type: 'radio', name: 'monk-mode', checked: c.mode === m,
        onchange: () => { setSite({ mode: m }); location.reload(); } }),
      m === 'default' ? `Default (${MODE_LABEL[store.def]})` : MODE_LABEL[m]));

    const checks = Object.keys(ALLOW_LABEL).map(k => h('label', {},
      h('input', { type: 'checkbox', checked: c.allow[k],
        onchange: e => { setSite({ allow: { [k]: e.target.checked } }); if (mode !== 'off') location.reload(); } }),
      ALLOW_LABEL[k]));

    const def = h('select', {
      onchange: e => {
        store = load();
        store.def = e.target.value;
        save();
        if (siteCfg().mode === 'default') location.reload();
      },
    }, ['off', 'lite', 'static', 'auto'].map(m => h('option', { value: m, selected: store.def === m }, MODE_LABEL[m])));

    return h('div', { id: 'monk-panel', role: 'dialog', 'aria-label': 'monk settings' },
      h('div', { class: 'monk-h' }, h('b', {}, 'monk'), host,
        h('span', { class: 'monk-now' }, `now: ${MODE_LABEL[mode]}${once ? ' (once)' : ''}`)),
      late && h('p', { class: 'monk-warn' },
        '⚠ Tampermonkey started monk after the page began loading, so some of it got through. ',
        'Tampermonkey → Settings (Config mode: Advanced) → Inject Mode: Instant fixes this where it is offered.'),
      h('div', { class: 'monk-sec' }, 'This site'),
      h('div', { class: 'monk-row' }, radios),
      c.needsJS && h('p', { class: 'monk-hint' }, 'This site needs JavaScript, so Static opens as Lite here. ',
        btn('Forget', () => { setSite({ needsJS: false }); location.reload(); })),
      h('div', { class: 'monk-sec' }, 'Let through (Lite & Static)'),
      h('div', { class: 'monk-col' }, checks),
      h('div', { class: 'monk-btns' },
        mode !== 'off' && !allow.img && btn('Load images here', e => {
          e.target.textContent = 'Loading…';
          loadAllImages().then(() => { e.target.textContent = 'Load images here'; });
        }),
        mode !== 'off' && btn('Full page once', () => reloadOnce({ mode: 'off' }))),
      h('div', { class: 'monk-sec' }, 'Default for every other site'),
      def,
      h('p', { class: 'monk-hint' },
        'Lite: the site works with its own scripts, but images, video, fonts, ads and trackers are not downloaded. ',
        'Static: no JavaScript or CSS — plain HTML, like Gmail\'s old basic view; sites that need JavaScript switch to Lite by themselves. ',
        'Auto: Static on 2G / data saver, Lite on 3G, Off on faster connections. ',
        'Alt+Shift+M opens this panel.'));
  }

  function outside(e) {
    if (panel && !panel.contains(e.target) && e.target !== pill) closePanel();
  }
  function closePanel() {
    if (panel) panel.remove();
    panel = null;
    document.removeEventListener('mousedown', outside, true);
  }
  function togglePanel() {
    if (panel) return closePanel();
    ensureUIStyle();
    panel = buildPanel();
    document.documentElement.append(panel);
    document.addEventListener('mousedown', outside, true);
  }

  function toast(...kids) {
    ensureUIStyle();
    const t = h('div', { id: 'monk-toast', role: 'status' }, ...kids, btn('OK', () => t.remove()));
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 12000);
  }

  function addPill() {
    ensureUIStyle();
    pill = h('button', { id: 'monk-pill', type: 'button', title: 'monk – minimal mode (Alt+Shift+M)', onclick: togglePanel },
      'M · ' + MODE_LABEL[mode]);
    document.documentElement.append(pill);
  }

  // ── 10. Start ─────────────────────────────────────────────────────────────
  GM_registerMenuCommand('monk: settings (Alt+Shift+M)', togglePanel);
  for (const m of ['off', 'lite', 'static']) {
    GM_registerMenuCommand(`monk: ${MODE_LABEL[m]} on this site`, () => { setSite({ mode: m }); location.reload(); });
  }
  window.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); togglePanel(); }
    else if (e.key === 'Escape' && panel) closePanel();
  }, true);

  let late = false;   // set when the page was already partly parsed at start
  if (mode === 'off') return;

  // Tampermonkey runs us once <html> exists; if it ever runs earlier, wait.
  if (document.documentElement) start();
  else new MutationObserver((_, o) => {
    if (document.documentElement) { o.disconnect(); start(); }
  }).observe(document, { childList: true });

  function start() {
    late = !!document.querySelector('link[rel~="stylesheet" i], style, script[src], body');
    injectCSP();
    if (mode === 'static' && late) stripPageCSS();

    if (isYouTube && mode === 'lite') {
      try {
        const now = Date.now();
        localStorage.setItem('yt-player-quality', JSON.stringify({
          data: JSON.stringify({ quality: 144, previousQuality: 144 }),
          expiration: now + 30 * 864e5, creation: now,
        }));
      } catch {}
    }

    addStyle(mode === 'static' ? STATIC_CSS : LITE_CSS);

    const ready = () => {
      if (mode === 'static') staticPass();
      addPill();
      if (once && once.note === 'needsJS') {
        toast('monk: this site needs JavaScript, so it opened in Lite (its own scripts only). It will from now on. ',
          btn('Keep it Static', () => { setSite({ mode: 'static' }); location.reload(); }));
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }
})();
