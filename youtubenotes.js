/*
 * File: youtubenotes.js
 * Author: vididvidid 
 * Created: 2026-07-27 22:31:14
 *
 * versions: 
 * 
 * 0.2.0          watched videos record, 
 *                block watched videos
 *
 * 0.1.0          notes Ui box below video and shorts
 *                global display of notes over video thumnail
 */


(function () {
  'use strict';

  console.log(" AIUtils WSL Link Working! Timestamp: " + Date.now());

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
      isWatched(id) {
        const data = load();
        return !!(data[id] && data[id].watched);
      },
      markWatched(id, type) {
        const data = load();
        if (!data[id]) {
          data[id] = { type: type || 'video', note: '', watched: true, updated: Date.now() };
        } else {
          data[id].watched = true;
        }
        persist();
        notify(id);
      },
      set(id, note, type) {
        const data = load();
        const trimmed = (note || '').trim();
        if (!trimmed) {
          if (data[id]) {
            if (data[id].watched) {
              data[id].note = '';
              data[id].updated = Date.now();
            } else {
              delete data[id];
            }
            persist();
            notify(id);
          }
          return;
        }
        if (!data[id]) {
          data[id] = {};
        }
        data[id].type = type || data[id].type || 'video';
        data[id].note = note;
        if (typeof data[id].watched === 'undefined') {
          data[id].watched = false;
        }
        data[id].updated = Date.now();
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

  function getActiveShortRenderer() {
    let renderer = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (!renderer) {
      const player = document.querySelector('ytd-shorts #shorts-player, ytm-shorts #shorts-player, ytd-shorts ytd-player');
      if (player) renderer = player.closest('ytd-reel-video-renderer, ytm-reel-video-renderer');
    }
    return renderer;
  }

  function getActiveShortMetapanel() {
    const activeRenderer = getActiveShortRenderer();
    return activeRenderer ? activeRenderer.querySelector('yt-reel-metapanel-view-model') : null;
  }

  function getLegacyChannelInfoContainer() {
    const activeRenderer = getActiveShortRenderer();
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
   * VIDEO PLAYER OVERLAY (Already Watched)
   * ============================================================ */

  const dismissedOverlays = new Set();
  let currentNavigatedVideo = null;
  let currentNavigatedVideoWasWatched = false;

  function markCurrentVideoSeen(info) {
    if (!info) return;
    if (info.id !== currentNavigatedVideo) {
      currentNavigatedVideo = info.id;
      currentNavigatedVideoWasWatched = Store.isWatched(info.id);
      Store.markWatched(info.id, info.type);
    }
  }

  let enforcerTimer = null;
  function startEnforcer() {
    if (enforcerTimer) return;
    enforcerTimer = setInterval(() => {
      const current = getCurrentPageVideo();
      if (!current) return;

      if (current.id !== currentNavigatedVideo) {
        onNavigate();
      }

      checkAndApplyOverlay();
    }, 150);
  }

  function removeVideoPlayerOverlay() {
    document.querySelectorAll('.ytnotes-video-overlay').forEach(el => el.remove());
    document.querySelectorAll('video').forEach(v => {
      if (v._ytnotesPaused) {
        if (v._ytnotesOriginalMuted !== undefined) {
          v.muted = v._ytnotesOriginalMuted;
          delete v._ytnotesOriginalMuted;
        }
        if (v.paused) {
          const container = v.closest('.html5-video-player');
          const playBtn = container ? container.querySelector('.ytp-play-button') : null;
          if (playBtn) playBtn.click();
          else v.play().catch(()=>{});
        }
        delete v._ytnotesPaused;
      }
    });
  }

  let lastShortsScrollPos = null;

  function checkAndApplyOverlay() {
    const current = getCurrentPageVideo();
    if (!current) return;

    markCurrentVideoSeen(current);

    const wasWatchedBefore = currentNavigatedVideoWasWatched;

    if (!wasWatchedBefore || Store.has(current.id) || dismissedOverlays.has(current.id)) {
      removeVideoPlayerOverlay();
      return;
    }

    let container = null;
    let videoEl = null;
    if (current.type === 'video') {
      container = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      videoEl = document.querySelector('video.html5-main-video') || document.querySelector('video');
    } else {
      let activeRenderer = getActiveShortRenderer();
      if (activeRenderer) {
        const currentPos = activeRenderer.getBoundingClientRect().top;
        if (lastShortsScrollPos !== null && Math.abs(currentPos - lastShortsScrollPos) > 10) {
           lastShortsScrollPos = currentPos;
           return; // Abort during scroll transition
        }
        lastShortsScrollPos = currentPos;
        container = activeRenderer.querySelector('.short-video-container') || activeRenderer;
        videoEl = activeRenderer.querySelector('video');
      }
    }

    if (!container) return;

    // Clean up left-over overlays in wrong containers (critical for shorts scrolling)
    document.querySelectorAll('.ytnotes-video-overlay').forEach(el => {
      if (el.parentElement !== container) el.remove();
    });

    let overlay = container.querySelector('.ytnotes-video-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ytnotes-video-overlay';
      
      const icon = document.createElement('div');
      icon.className = 'ytnotes-video-overlay-icon';
      icon.textContent = '❌';
      overlay.appendChild(icon);
      
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (confirm('Do you really want to watch this video again?')) {
          dismissedOverlays.add(current.id);
          removeVideoPlayerOverlay();
        }
      });
      
      const style = window.getComputedStyle(container);
      if (style.position === 'static') {
        container.style.position = 'relative';
      }
      container.appendChild(overlay);
    }

    // Always enforce pause/mute on ALL videos in the active renderer
    if (current.type === 'shorts') {
       const activeRenderer = getActiveShortRenderer();
       if (activeRenderer) {
         activeRenderer.querySelectorAll('video').forEach(v => {
           if (!v.paused) v.pause();
           if (v._ytnotesOriginalMuted === undefined) v._ytnotesOriginalMuted = v.muted;
           v.muted = true;
           v._ytnotesPaused = true;
         });
       }
    } else if (videoEl) {
       if (!videoEl.paused) videoEl.pause();
       if (videoEl._ytnotesOriginalMuted === undefined) videoEl._ytnotesOriginalMuted = videoEl.muted;
       videoEl.muted = true;
       videoEl._ytnotesPaused = true;
    }
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

  function updateThumbnailOverlay(anchor, id) {
    const hasNote = Store.has(id);
    const isWatched = Store.isWatched(id);

    let overlay = anchor.querySelector('.ytnotes-thumbnail-overlay');
    
    if (!hasNote && !isWatched) {
      if (overlay) overlay.remove();
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ytnotes-thumbnail-overlay';
      const style = getComputedStyle(anchor);
      if (style.position === 'static') anchor.style.position = 'relative';
      anchor.appendChild(overlay);
    }

    if (hasNote) {
      overlay.className = 'ytnotes-thumbnail-overlay ytnotes-thumbnail-overlay-note';
      overlay.textContent = Store.get(id);
    } else {
      overlay.className = 'ytnotes-thumbnail-overlay ytnotes-thumbnail-overlay-cross';
      overlay.textContent = '❌';
    }
  }

  function processAnchor(anchor) {
    if (!isThumbnailAnchor(anchor)) return;

    const info = extractIdFromHref(anchor.getAttribute('href'));
    if (!info) return;

    anchor.setAttribute('data-ytnotes-video-id', info.id);
    updateThumbnailOverlay(anchor, info.id);
  }

  function processAllThumbnails(root) {
    deepQueryAll(root, THUMBNAIL_LINK_SELECTOR).forEach(processAnchor);
  }

  const scheduleThumbnailScan = debounce(() => processAllThumbnails(), SCAN_DEBOUNCE_MS);

  function refreshOverlaysForId(id) {
    deepQueryAll(document, `a[data-ytnotes-video-id="${CSS.escape(id)}"]`).forEach((anchor) => {
      updateThumbnailOverlay(anchor, id);
    });

    const current = getCurrentPageVideo();
    if (current && current.id === id) {
      if (Store.has(id)) {
        removeVideoPlayerOverlay();
      } else {
        checkAndApplyOverlay();
      }
    }
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

    if (!fallbackTimer) {
      fallbackTimer = setInterval(() => processAllThumbnails(), FALLBACK_SCAN_INTERVAL_MS);
    }
  }

  /* ============================================================
   * SPA NAVIGATION HANDLING
   * ============================================================ */

  function onNavigate() {
      // Re-run injections when navigating
      if (location.pathname === '/watch') {
        retryUntil(attachWatchPage);
      } else if (location.pathname.startsWith('/shorts/')) {
        retryUntil(attachShortPage);
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

      .ytnotes-video-overlay {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 2147483647 !important;
        background: rgba(0, 0, 0, 0.85) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        pointer-events: auto !important;
      }
      .ytnotes-video-overlay-icon {
        font-size: 150px !important;
        color: #ff0000 !important;
        line-height: 1 !important;
        text-shadow: 0 8px 24px rgba(0,0,0,0.8) !important;
        user-select: none !important;
      }

      .ytnotes-thumbnail-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99;
        pointer-events: none;
        max-height: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #0a0a0a;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
          "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.01em;
      }
      .ytnotes-thumbnail-overlay-note {
        background: rgba(255, 255, 255, 0.95) !important;
        color: #000 !important;
        inset: 0 !important;
        padding: 16px !important;
        display: -webkit-box !important;
        -webkit-box-orient: vertical !important;
        -webkit-line-clamp: 6 !important;
        overflow: hidden !important;
        font-size: 15px !important;
        font-weight: bold !important;
        text-align: left !important;
        white-space: normal !important;
      }
      .ytnotes-thumbnail-overlay-cross {
        background: rgba(0, 0, 0, 0.7) !important;
        color: white !important;
        font-size: 40px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        inset: 0 !important;
        padding: 0 !important;
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
    startEnforcer();

    if (location.pathname === '/watch') {
      retryUntil(attachWatchPage);
    } else if (location.pathname.startsWith('/shorts/')) {
      retryUntil(attachShortPage);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
