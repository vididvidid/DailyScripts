/*
 * File: youtubenotes.js
 * Author: vididvidid 
 * Created: 2026-07-27 22:31:14
 */

// ==UserScript==
// @name         YouTube Personal Notes (Watched Memory)
// @namespace    https://local.userscripts/yt-personal-notes
// @version      1.1.0
// @description  Write a permanent personal note on any YouTube video/Short. Notes auto-save and show on every thumbnail everywhere on YouTube (home, search, related, channel, subs, history, playlists, shorts shelves).
// @author       you
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @icon         https://www.youtube.com/s/desktop/512d15a2/img/favicon_32.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * CONFIG
   * ============================================================ */
  const STORAGE_KEY = 'ytPersonalNotes_v1';
  const SAVE_DEBOUNCE_MS = 300;
  const SCAN_DEBOUNCE_MS = 150;
  const FALLBACK_SCAN_INTERVAL_MS = 1000; // safety-net rescan, catches shelves the observer missed
  const RETRY_INTERVAL_MS = 300;
  const RETRY_MAX_ATTEMPTS = 25; // ~7.5s of retrying before giving up

  /* ============================================================
   * STORAGE LAYER (single object in localStorage, keyed by video id)
   * ============================================================ */
  const Store = (function () {
    let cache = null;
    const listeners = new Set();

    function load() {
      if (cache) return cache;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.warn('[YT Notes] Corrupt storage, resetting.', e);
        cache = {};
      }
      return cache;
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      } catch (e) {
        console.warn('[YT Notes] Could not persist notes (storage full?).', e);
      }
    }

    function notify(id) {
      listeners.forEach((fn) => {
        try { fn(id); } catch (e) { /* ignore listener errors */ }
      });
    }

    return {
      get(id) {
        const data = load();
        return data[id] ? data[id].note : '';
      },
      has(id) {
        const data = load();
        return !!(data[id] && data[id].note && data[id].note.trim());
      },
      set(id, note, type) {
        const data = load();
        const trimmed = (note || '').trim();
        if (!trimmed) {
          if (data[id]) {
            delete data[id];
            persist();
            notify(id);
          }
          return;
        }
        data[id] = {
          type: type || (data[id] && data[id].type) || 'video',
          note: note,
          updated: Date.now()
        };
        persist();
        notify(id);
      },
      onChange(fn) {
        listeners.add(fn);
      }
    };
  })();

  /* ============================================================
   * UTILITIES
   * ============================================================ */

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // Pull {id, type} from any href pointing at /watch?v= or /shorts/
  function extractIdFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (url.pathname === '/watch') {
        const v = url.searchParams.get('v');
        if (v) return { id: v, type: 'video' };
      }
      const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch) return { id: shortsMatch[1], type: 'short' };
    } catch (e) { /* malformed url, ignore */ }
    return null;
  }

  function getCurrentPageVideo() {
    return extractIdFromHref(location.href);
  }

  function safeQuery(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) { /* invalid selector for this YT version, skip */ }
    }
    return null;
  }

  // Retry a check/attach function until it succeeds or attempts run out.
  function retryUntil(fn, attempts = RETRY_MAX_ATTEMPTS, interval = RETRY_INTERVAL_MS) {
    let count = 0;
    const tick = () => {
      let done = false;
      try {
        done = !!fn();
      } catch (e) {
        console.warn('[YT Notes] retry attempt failed', e);
      }
      count += 1;
      if (!done && count < attempts) {
        setTimeout(tick, interval);
      }
    };
    tick();
  }

  // Recursively collects matches for `selector`, piercing any OPEN shadow
  // roots along the way. YouTube's web-component renderers (yt-lockup-*,
  // ytm-shorts-lockup-*, etc.) sometimes attach shadow DOM, and a plain
  // document.querySelectorAll silently skips anything inside one. This is
  // the most likely reason notes rendered in some shelves (search results,
  // "Videos" tab) but not others (channel horizontal lists, Shorts shelves)
  // using the exact same renderer markup.
  function deepQueryAll(root, selector, out) {
    out = out || [];
    const scope = root || document;
    scope.querySelectorAll(selector).forEach((el) => out.push(el));
    const all = scope.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        deepQueryAll(el.shadowRoot, selector, out);
      }
    }
    return out;
  }

  /* ============================================================
   * SHARED NOTE TEXTAREA FACTORY (watch page + shorts page)
   * ============================================================ */

  function createNoteTextarea(id, type, placeholder) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ytnotes-box-wrapper';

    const textarea = document.createElement('textarea');
    textarea.className = 'ytnotes-textarea';
    textarea.placeholder = placeholder;
    textarea.value = Store.get(id);
    textarea.rows = 2;
    textarea.setAttribute('data-ytnotes-id', id);

    const statusEl = document.createElement('div');
    statusEl.className = 'ytnotes-status';

    const debouncedSave = debounce((val) => {
      Store.set(id, val, type);
      statusEl.textContent = 'Saved ✓';
      clearTimeout(statusEl._hideTimer);
      statusEl._hideTimer = setTimeout(() => { statusEl.textContent = ''; }, 1200);
    }, SAVE_DEBOUNCE_MS);

    textarea.addEventListener('input', () => {
      statusEl.textContent = 'Saving…';
      debouncedSave(textarea.value);
    });

    ['keydown', 'keyup', 'keypress'].forEach((evt) => {
      textarea.addEventListener(evt, (e) => e.stopPropagation());
    });

    wrapper.appendChild(textarea);
    wrapper.appendChild(statusEl);
    return wrapper;
  }

  /* ============================================================
   * WATCH PAGE (textarea above the title)
   * ============================================================ */

  function attachWatchPage() {
    const current = getCurrentPageVideo();
    if (!current || current.type !== 'video') return true;

    const metadata = document.querySelector('ytd-watch-metadata');
    if (!metadata) return false;

    const titleRow = safeQuery(metadata, ['#title-row', '#title h1', '#title']);
    if (!titleRow || !titleRow.parentElement) return false;

    const existing = metadata.querySelector('.ytnotes-watch-box');
    if (existing) {
      if (existing.getAttribute('data-video-id') === current.id) return true;
      existing.remove();
    }

    const box = createNoteTextarea(current.id, 'video', 'Write a note about this video (auto-saves)...');
    box.classList.add('ytnotes-watch-box');
    box.setAttribute('data-video-id', current.id);

    titleRow.parentElement.insertBefore(box, titleRow);
    return true;
  }

  /* ============================================================
   * SHORTS PLAYER PAGE (textarea above channel name)
   * ============================================================ */

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
  }

  function getActiveShortMetapanel() {
    const panels = document.querySelectorAll('yt-reel-metapanel-view-model');
    for (const panel of panels) {
      if (isVisible(panel)) return panel;
    }
    return null;
  }

  function getLegacyChannelInfoContainer() {
    const activeRenderer = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (!activeRenderer) return null;
    const channelInfo = safeQuery(activeRenderer, [
      'ytd-reel-player-header-renderer',
      '#channel-info',
      'ytd-channel-name'
    ]);
    if (!channelInfo) return null;
    return channelInfo.closest('ytd-reel-player-header-renderer') || channelInfo.parentElement;
  }

  function attachShortPage() {
    const current = getCurrentPageVideo();
    if (!current || current.type !== 'short') return true;

    const container = getActiveShortMetapanel() || getLegacyChannelInfoContainer();
    if (!container) return false;

    const existing = container.querySelector('.ytnotes-shorts-box');
    if (existing) {
      if (existing.getAttribute('data-video-id') === current.id) return true;
      existing.remove();
    }
    document.querySelectorAll('.ytnotes-shorts-box').forEach((box) => {
      if (box.closest('yt-reel-metapanel-view-model, ytd-reel-player-header-renderer') !== container) {
        box.remove();
      }
    });

    const box = createNoteTextarea(current.id, 'short', 'Write a note about this Short (auto-saves)...');
    box.classList.add('ytnotes-shorts-box');
    box.setAttribute('data-video-id', current.id);

    container.insertBefore(box, container.firstChild);
    return true;
  }

  /* ============================================================
   * THUMBNAIL OVERLAYS (home, search, related, channel, subs,
   * history, playlists, Shorts shelves, Shorts grid — everywhere)
   * ============================================================ */

  // Every thumbnail across every YouTube surface, regardless of which
  // renderer wraps it (yt-lockup-view-model, ytd-rich-item-renderer,
  // ytm-shorts-lockup-view-model, etc.), is ultimately a link to
  // /watch?v=... or /shorts/... wrapping an <img>. We key off that
  // instead of chasing renderer tag names.
  const THUMBNAIL_LINK_SELECTOR = 'a[href^="/watch"], a[href^="/shorts"]';

  function isThumbnailAnchor(a) {
    return !!a.querySelector('img, yt-image, yt-thumbnail-view-model, ytd-thumbnail, .ytCoreImageHost');
  }

  function renderOverlay(anchor, note) {
    let overlay = anchor.querySelector(':scope > .ytnotes-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ytnotes-overlay';
      const inner = document.createElement('span');
      inner.className = 'ytnotes-overlay-text';
      overlay.appendChild(inner);
      const style = getComputedStyle(anchor);
      if (style.position === 'static') anchor.style.position = 'relative';
      anchor.appendChild(overlay);
    }
    overlay.querySelector('.ytnotes-overlay-text').textContent = note;

    // Scale the type to the thumbnail's own width so a small channel-shelf
    // thumb and a big home-page thumb both read as "one big confident line".
    const width = anchor.getBoundingClientRect().width || 200;
    const fontSize = Math.max(13, Math.min(30, width * 0.085));
    overlay.style.fontSize = fontSize + 'px';
  }

  function removeOverlay(anchor) {
    const overlay = anchor.querySelector(':scope > .ytnotes-overlay');
    if (overlay) overlay.remove();
  }

  function processAnchor(anchor) {
    if (!isThumbnailAnchor(anchor)) return;

    const info = extractIdFromHref(anchor.getAttribute('href'));
    if (!info) return;

    anchor.setAttribute('data-ytnotes-video-id', info.id);

    if (Store.has(info.id)) {
      renderOverlay(anchor, Store.get(info.id));
    } else {
      removeOverlay(anchor);
    }
  }

  function processAllThumbnails(root) {
    deepQueryAll(root, THUMBNAIL_LINK_SELECTOR).forEach(processAnchor);
  }

  const scheduleThumbnailScan = debounce(() => processAllThumbnails(), SCAN_DEBOUNCE_MS);

  function refreshOverlaysForId(id) {
    deepQueryAll(document, `a[data-ytnotes-video-id="${CSS.escape(id)}"]`).forEach((anchor) => {
      if (Store.has(id)) {
        renderOverlay(anchor, Store.get(id));
      } else {
        removeOverlay(anchor);
      }
    });
  }
  Store.onChange(refreshOverlaysForId);

  /* ============================================================
   * OBSERVERS
   * ============================================================ */

  let feedObserver = null;
  let shortsObserver = null;
  let fallbackTimer = null;

  function observeFeeds() {
    processAllThumbnails();

    if (!feedObserver) {
      feedObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length) {
            scheduleThumbnailScan();
            break;
          }
        }
      });
      feedObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Safety net: shelves that render inside shadow roots created before
    // this observer attached, or that mutate in ways the observer misses,
    // still get picked up within ~1s. Cheap because processAllThumbnails
    // is a no-op per-anchor once data-ytnotes-video-id + overlay exist.
    if (!fallbackTimer) {
      fallbackTimer = setInterval(() => processAllThumbnails(), FALLBACK_SCAN_INTERVAL_MS);
    }
  }

  function observeShortsActivePlayer() {
    if (shortsObserver) shortsObserver.disconnect();
    const shortsRoot = document.querySelector('ytd-shorts') || document.body;
    shortsObserver = new MutationObserver(() => retryUntil(attachShortPage));
    shortsObserver.observe(shortsRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active']
    });
  }

  /* ============================================================
   * SPA NAVIGATION HANDLING
   * ============================================================ */

  function onNavigate() {
    scheduleThumbnailScan();

    if (location.pathname === '/watch') {
      retryUntil(attachWatchPage);
    } else if (location.pathname.startsWith('/shorts/')) {
      retryUntil(attachShortPage);
      observeShortsActivePlayer();
    }
  }

  document.addEventListener('yt-navigate-finish', onNavigate);
  document.addEventListener('yt-page-data-updated', onNavigate);

  /* ============================================================
   * STYLES
   * ============================================================ */

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .ytnotes-box-wrapper {
        margin: 8px 0;
        width: 100%;
        box-sizing: border-box;
      }
      .ytnotes-textarea {
        width: 100%;
        min-height: 44px;
        resize: vertical;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 13px;
        line-height: 1.4;
        font-family: "Roboto", Arial, sans-serif;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.15);
        background: #f2f2f2;
        color: #0f0f0f;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .ytnotes-textarea:focus { border-color: #3ea6ff; }
      .ytnotes-textarea::placeholder { color: #606060; }
      html[dark] .ytnotes-textarea, [dark] .ytnotes-textarea {
        background: #272727;
        color: #f1f1f1;
        border-color: rgba(255,255,255,0.15);
      }
      .ytnotes-status {
        font-size: 11px;
        color: #909090;
        margin-top: 2px;
        min-height: 14px;
      }
      .ytnotes-watch-box { margin-bottom: 10px; }
      .ytnotes-shorts-box { margin-bottom: 6px; }
      .ytnotes-shorts-box .ytnotes-textarea {
        background: rgba(0,0,0,0.55);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.25);
      }
      .ytnotes-shorts-box .ytnotes-status { color: rgba(255,255,255,0.75); }

      /* Full-thumbnail "keynote slide" note overlay: covers the entire
         thumbnail, white background, big bold left-aligned text. */
      .ytnotes-overlay {
        position: absolute;
        inset: 0;
        z-index: 2200;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 16px 18px;
        box-sizing: border-box;
        pointer-events: none;
        border-radius: inherit;
        overflow: hidden;
      }
      .ytnotes-overlay-text {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        text-align: left;
        color: #0a0a0a;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
          "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.01em;
      }
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
   * INIT
   * ============================================================ */

  function init() {
    injectStyles();
    observeFeeds();

    if (location.pathname === '/watch') {
      retryUntil(attachWatchPage);
    } else if (location.pathname.startsWith('/shorts/')) {
      retryUntil(attachShortPage);
      observeShortsActivePlayer();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
