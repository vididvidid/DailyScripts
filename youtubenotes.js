/*
 * File: youtubenotes.js
 * Author: vididvidid 
 * Created: 2026-07-27 22:31:14
 *
 * versions:
 *
 * 0.5.4          no longer runs a second time inside the live chat iframe
 *                (duplicate ⇅ button and doubled sync timers on streams
 *                and premieres with chat replay)
 *
 * 0.5.3          the gist button was a 45%-opacity grey circle that read
 *                as a scroll widget, and in bookmarklet mode it is the only
 *                way into gist sync — until a token is connected it is now
 *                YouTube-red with a "Connect Gist" label
 *
 * 0.5.2          runs as a bookmarklet (phone browsers) with gist sync
 *                intact — youtube.com declares no connect-src, so the
 *                fetch() fallback really does reach api.github.com;
 *                the panel no longer claims Tampermonkey holds the
 *                token when a shim does
 *
 * 0.5.1          reflection actually fires — the 15s threshold was
 *                suppressing the very scrolling it exists to interrupt,
 *                and an unreadable duration silently meant "say nothing";
 *                card now follows a video into fullscreen;
 *                YTNotes.reflection.debug() explains every decision
 *
 * 0.5.0          reflection prompt on short-form videos, eager gist
 *                flushing, hover-preview suppression, pause every
 *                <video> behind the block (not just the first)
 *
 * 0.4.0          GitHub Gist sync for the watched list (videos.gist +
 *                shorts.gist), so every device shares one list;
 *                floating button to connect a token
 *
 * 0.3.0          YouTube history sync (cross-device / cross-account):
 *                pulls /feed/history in the background via InnerTube
 *                so videos watched on any device or signed-in account
 *                are known here too
 *
 * 0.2.0          watched videos record, 
 *                block watched videos
 *
 * 0.1.0          notes Ui box below video and shorts
 *                global display of notes over video thumnail
 */


/**
 * ============================================================================
 * ARCHITECTURE OVERVIEW
 * ============================================================================
 * One IIFE, organised top to bottom as layers. Later layers use earlier ones,
 * never the reverse — so the file reads in dependency order.
 *
 *   1. Config         constants + tuning: HISTORY_SYNC, GIST_SYNC, REFLECTION,
 *                     storage keys. No logic.
 *
 *   2. Store          the single localStorage object, keyed by video id:
 *                     { type, note, watched, fb, src, updated }
 *                     get/set/has · isWatched/markWatched · markWatchedBulk
 *                     (one write for thousands of ids) · getFeedback/setFeedback
 *                     watchedIds (split video/short, for the gist) · clearSynced
 *                     stats · onChange/onBulkChange
 *
 *   3. Utilities      debounce · extractIdFromHref · getCurrentPageVideo
 *                     deepQueryAll (pierces open shadow roots) · retryUntil
 *                     toast
 *
 *   4. Note boxes     createNoteTextarea, then one attacher per surface:
 *                     attachWatchPage · attachShortPage
 *
 *   5. Player block   the ❌ over an already-watched video.
 *                     markCurrentVideoSeen decides "have I seen this?",
 *                     holding the verdict until the syncs answer;
 *                     checkAndApplyOverlay paints and pauses;
 *                     startEnforcer re-checks every 150ms because YouTube
 *                     rebuilds its DOM constantly.
 *
 *   6. Preview guard  previewSubjectId · suppressHoverPreviews — stops a
 *                     watched video playing inside its own thumbnail, in the
 *                     layer YouTube renders above our overlay.
 *
 *   7. Thumbnails     the ❌ / note / verdict painted over every thumbnail,
 *                     everywhere: updateThumbnailOverlay · processAnchor
 *                     processAllThumbnails.
 *
 *   8. HistorySync    "watched" from YouTube's own servers, so a phone counts.
 *                     POST /youtubei/v1/browse { browseId: FEhistory }, walked
 *                     by continuation token, across every signed-in authuser.
 *                     getInnertube · browse · extract · ingest · syncAccount
 *                     run · gate (what the player block waits on).
 *
 *   9. Net / Secrets  GM_xmlhttpRequest wrapper (YouTube's CSP blocks fetch to
 *                     GitHub) + token storage in GM_setValue, not localStorage.
 *
 *  10. GistSync       one watched list across all your machines: two files,
 *                     videos.gist + shorts.gist, ids only, merged as a union
 *                     so no device can clobber another.
 *                     resolveGistId (adopt or create) · pull · push · sync
 *                     schedulePush/flush (survives a closing lid) · connect.
 *
 *  11. GistUI         the draggable ⇅ button and its panel. mount · makeDraggable
 *                     reparentForFullscreen · render/buildConnected/buildDisconnected.
 *
 *  12. Reflection     the speed bump: what was that, and why did you watch it.
 *                     tick/sample/decide/closeOut (queueing) ·
 *                     showNext/buildCard/chipRow (asking) · summary/debug.
 *
 *  13. Observers      observeFeeds + onNavigate — SPA navigation and DOM churn.
 *  14. Styles         injectStyles: every rule in the script, one place.
 *  15. Init           init + exposeApi (window.YTNotes, Tampermonkey menu).
 *
 * To change how aggressive the speed bump is:  REFLECTION in Config
 * To change what it asks:                      REFLECTION.whatOptions/whyOptions
 * To add a surface that shows notes:           an attacher in layer 4
 * To change any colour or size:                injectStyles only
 * To see why a prompt did not appear:          YTNotes.reflection.debug()
 * ============================================================================
 */
(function () {
  'use strict';

  // YouTube embeds same-origin iframes (live chat / chat replay), and a userscript
  // matching youtube.com/* runs in each one — a second ⇅ button, a second set of
  // sync timers. Only the top window gets the script.
  if (window.top !== window.self) return;

  console.log(" AIUtils WSL Link Working! Timestamp: " + Date.now());

  /* ============================================================
   * CONFIG
   * ============================================================ */
  const STORAGE_KEY = 'ytPersonalNotes_v1';
  const HISTORY_META_KEY = 'ytPersonalNotes_historyMeta_v1';
  const SAVE_DEBOUNCE_MS = 300;
  const SCAN_DEBOUNCE_MS = 150;
  const FALLBACK_SCAN_INTERVAL_MS = 1000; // safety-net rescan, catches shelves the observer missed
  const RETRY_INTERVAL_MS = 300;
  const RETRY_MAX_ATTEMPTS = 25; // ~7.5s of retrying before giving up

  // Everything about pulling watch history off YouTube's servers.
  const HISTORY_SYNC = {
    enabled: true,
    // How long the "already watched?" block on a freshly opened video
    // waits for the first page of history before giving up and letting
    // the video play. Only the first page is waited on; the deeper
    // pages keep loading behind it.
    firstPageGateMs: 4000,
    // Background re-sync cadence while a tab stays open, and how old the
    // last sync must be before a page load / tab focus triggers a new one.
    intervalMs: 15 * 60 * 1000,
    staleMs: 2 * 60 * 1000,
    // A history page is ~100 entries. The first ever sync walks deep to
    // build a baseline; after that we only need to reach the point where
    // server history and local records agree again.
    maxPagesFull: 60,
    maxPagesIncremental: 4,
    pageDelayMs: 250, // be polite between continuation requests
    // 0 = anything that reached your history counts as watched. Raise it
    // (e.g. 15) to ignore videos you bailed out of after a few seconds.
    minWatchPercent: 0,
    // The video you just opened is pushed to the top of server history
    // within seconds, which makes "already watched?" ambiguous for that
    // one entry. Its resume bar settles it: playback that started moments
    // ago cannot be this far in, so the progress came from another device.
    selfTopWatchedPercent: 10,
    // Sync every signed-in Google account in this browser profile, not
    // just the active one (?authuser=N).
    syncAllAccounts: true,
    maxAuthUserProbe: 3,
    // Also harvest ids straight off /feed/history when you visit it.
    harvestDom: true,
    showToasts: true,
    // YouTube's hover preview plays inside the thumbnail, in its own
    // layer above our overlay — so a watched video starts playing behind
    // the ❌. Stop those previews on thumbnails we have marked.
    suppressHoverPreview: true
  };

  // Sharing the watched list between devices through a secret GitHub Gist.
  const GIST_SYNC = {
    enabled: true,
    api: 'https://api.github.com',
    // Ids only, one per line — ~12 bytes each, so this stays tiny.
    videosFile: 'videos.gist',
    shortsFile: 'shorts.gist',
    description: 'youtubenotes — watched video + shorts ids (synced across devices)',
    timeoutMs: 20000,
    intervalMs: 10 * 60 * 1000,  // background pull/push while a tab is open
    staleMs: 2 * 60 * 1000,      // minimum gap between syncs
    // Short enough that a closed laptop rarely loses anything, long
    // enough that a Shorts binge is still one request.
    pushDebounceMs: 10 * 1000,
    searchPages: 3,              // pages of /gists scanned when adopting an existing gist
    showButton: true
  };

  // The speed bump on short-form watching. See the REFLECTION section.
  const REFLECTION = {
    enabled: true,
    maxDurationSeconds: 600,  // only videos under 10 minutes
    includeShorts: true,      // every Short counts, whatever its length
    // Long enough to ignore a genuine mis-click, short enough that fast
    // scrolling still counts — scrolling IS the thing being interrupted,
    // so a high threshold here quietly switches the whole feature off.
    minWatchSeconds: 3,
    pauseSeconds: 3,          // dead chips for this long — the actual toll
    skipAfterSeconds: 6,      // "not now" costs twice what answering costs
    maxQueued: 25,
    randomisePlacement: true, // never the same spot twice, or it becomes reflex
    whatOptions: ['Timewaste', 'Entertainment', "Don't know"],
    whyOptions: ['Entertainment', 'Overwhelmed', 'Stress', 'Work']
  };

  // Credentials live in Tampermonkey storage, not localStorage.
  const GIST_KEYS = {
    TOKEN: 'ytnotes_gistToken',
    ID: 'ytnotes_gistId',
    LOGIN: 'ytnotes_gistLogin',
    LAST_SYNC: 'ytnotes_gistLastSync',
    LAST_ERROR: 'ytnotes_gistLastError',
    PENDING: 'ytnotes_gistPending'
  };

  /* ============================================================
   * STORAGE LAYER (single object in localStorage, keyed by video id)
   * ============================================================ */
  const Store = (function () {
    let cache = null;
    const listeners = new Set();
    const bulkListeners = new Set();

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

    function notifyBulk() {
      bulkListeners.forEach((fn) => {
        try { fn(); } catch (e) { /* ignore listener errors */ }
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
      // Bulk path for history sync. A per-id markWatched() would
      // re-stringify the whole store and fire a listener thousands of
      // times over; this writes once and fires one bulk event.
      markWatchedBulk(items, source) {
        const data = load();
        const now = Date.now();
        let changed = 0;
        for (const item of items) {
          if (!item || !item.id) continue;
          const entry = data[item.id];
          if (!entry) {
            data[item.id] = {
              type: item.type || 'video',
              note: '',
              watched: true,
              updated: now,
              src: source || 'history'
            };
            changed += 1;
          } else if (!entry.watched) {
            entry.watched = true;
            if (!entry.src) entry.src = source || 'history';
            changed += 1;
          }
        }
        if (changed) {
          persist();
          notifyBulk();
        }
        return changed;
      },
      // Drops watched flags that came from history sync, leaving notes
      // and anything this browser watched itself untouched.
      clearSynced() {
        const data = load();
        let removed = 0;
        for (const id of Object.keys(data)) {
          const entry = data[id];
          if (!entry || (entry.src !== 'history' && entry.src !== 'gist')) continue;
          if (entry.note && entry.note.trim()) {
            entry.watched = false;
            delete entry.src;
          } else {
            delete data[id];
          }
          removed += 1;
        }
        if (removed) {
          persist();
          notifyBulk();
        }
        return removed;
      },
      getFeedback(id) {
        const data = load();
        return (data[id] && data[id].fb) || null;
      },
      setFeedback(id, feedback) {
        const data = load();
        if (!data[id]) {
          data[id] = { type: 'video', note: '', watched: true, updated: Date.now() };
        }
        data[id].fb = feedback;
        data[id].updated = Date.now();
        persist();
        notify(id);
      },
      allFeedback() {
        const data = load();
        const out = [];
        for (const id of Object.keys(data)) {
          if (data[id] && data[id].fb) out.push(Object.assign({ id: id }, data[id].fb));
        }
        return out;
      },
      // The watched list, split the way the gist stores it.
      watchedIds() {
        const data = load();
        const videos = [];
        const shorts = [];
        for (const id of Object.keys(data)) {
          if (!data[id] || !data[id].watched) continue;
          (data[id].type === 'short' ? shorts : videos).push(id);
        }
        return { videos, shorts };
      },
      stats() {
        const data = load();
        let watched = 0;
        let notes = 0;
        let synced = 0;
        for (const id of Object.keys(data)) {
          if (data[id].watched) watched += 1;
          if (data[id].note && data[id].note.trim()) notes += 1;
          if (data[id].src === 'history' || data[id].src === 'gist') synced += 1;
        }
        return { total: Object.keys(data).length, watched, notes, fromHistory: synced };
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
      },
      onBulkChange(fn) {
        bulkListeners.add(fn);
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

  // Small, self-dismissing status pill. Click it to force a full re-sync.
  function toast(message, ms) {
    if (!HISTORY_SYNC.showToasts || !document.body) return;
    let el = document.querySelector('.ytnotes-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ytnotes-toast';
      el.title = 'Click to force a full history re-sync';
      el.addEventListener('click', () => HistorySync.fullResync());
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('ytnotes-toast-show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('ytnotes-toast-show'), ms || 3000);
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
  let pendingNavigation = null;
  // What we knew about the video this page opened on, captured before any
  // history sync can touch the store. A sync always contains the video
  // that is playing right now — YouTube logs it the moment playback
  // starts — so reading the store after one has landed would make every
  // video look like a re-watch.
  let bootVideoSnapshot = null;

  // Deciding "have I seen this already?" now has two sources: what this
  // browser recorded, and what YouTube's servers know from every other
  // device. The server answer arrives asynchronously, so the decision is
  // held open for a moment instead of being taken on local data alone.
  //
  // The local verdict is captured *before* a sync can write to the store,
  // otherwise the sync — which always contains the video currently
  // playing — would answer its own question.
  function markCurrentVideoSeen(info) {
    if (!info) return;
    if (info.id === currentNavigatedVideo) return;
    if (pendingNavigation && pendingNavigation.id === info.id) return;

    const nav = {
      id: info.id,
      type: info.type,
      watchedLocally: (bootVideoSnapshot && bootVideoSnapshot.id === info.id)
        ? bootVideoSnapshot.watched
        : Store.isWatched(info.id)
    };
    pendingNavigation = nav;

    HistorySync.gate(info.id).then((watchedElsewhere) => {
      if (pendingNavigation !== nav) return; // navigated away while waiting
      pendingNavigation = null;
      currentNavigatedVideo = nav.id;
      currentNavigatedVideoWasWatched = nav.watchedLocally || watchedElsewhere;
      Store.markWatched(nav.id, nav.type);
    });
  }

  let enforcerTimer = null;
  let lastEnforcedVideo = null;
  function startEnforcer() {
    if (enforcerTimer) return;
    enforcerTimer = setInterval(() => {
      const current = getCurrentPageVideo();
      if (!current) return;

      if (current.id !== lastEnforcedVideo) {
        lastEnforcedVideo = current.id;
        onNavigate();
      }

      checkAndApplyOverlay();
    }, 150);

    // Feeds and previews need watching whether or not a video is open.
    setInterval(() => {
      suppressHoverPreviews();
      Reflection.tick();
    }, 200);
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

    // Verdict for this video is still in flight (history sync in
    // progress). Never block on the previous video's answer.
    if (current.id !== currentNavigatedVideo) {
      removeVideoPlayerOverlay();
      return;
    }

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

    // Pause EVERY video behind the block, not just the one we happened to
    // match. YouTube keeps several <video> nodes alive at once (ads, the
    // next Short, the inline preview), and pausing a single one is why
    // audio used to keep playing from behind the ❌.
    const targets = new Set();
    container.querySelectorAll('video').forEach((v) => targets.add(v));
    if (current.type === 'short') {
      const activeRenderer = getActiveShortRenderer();
      if (activeRenderer) activeRenderer.querySelectorAll('video').forEach((v) => targets.add(v));
    }
    if (videoEl) targets.add(videoEl);

    targets.forEach((v) => {
      if (!v.paused) v.pause();
      if (v._ytnotesOriginalMuted === undefined) v._ytnotesOriginalMuted = v.muted;
      v.muted = true;
      v._ytnotesPaused = true;
    });
  }

  /* ============================================================
   * HOVER PREVIEW SUPPRESSION
   *
   * Hovering a thumbnail makes YouTube play a preview inside it, in a
   * layer of its own that sits above our overlay. The result is a
   * watched video happily playing behind the ❌ — the block is there,
   * the video plays anyway. These previews are not the main player, so
   * they are safe to stop outright.
   * ============================================================ */

  const RENDERER_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer,'
    + ' ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model,'
    + ' ytd-reel-item-renderer, ytm-shorts-lockup-view-model';

  // Which video id is this stray <video> previewing?
  function previewSubjectId(video) {
    const tagged = video.closest('[data-ytnotes-video-id]');
    if (tagged) return tagged.getAttribute('data-ytnotes-video-id');

    // The preview player is often hoisted out of the anchor, so fall back
    // to the surrounding lockup and read its thumbnail link.
    const renderer = video.closest(RENDERER_SELECTOR);
    if (!renderer) return null;
    const anchor = renderer.querySelector('a[data-ytnotes-video-id]')
      || renderer.querySelector(THUMBNAIL_LINK_SELECTOR);
    if (!anchor) return null;
    const marked = anchor.getAttribute('data-ytnotes-video-id');
    if (marked) return marked;
    const info = extractIdFromHref(anchor.getAttribute('href'));
    return info ? info.id : null;
  }

  function suppressHoverPreviews() {
    if (!HISTORY_SYNC.suppressHoverPreview) return;

    document.querySelectorAll('video').forEach((video) => {
      // Never touch the real player.
      if (video.closest('#movie_player, ytd-reel-video-renderer, ytd-shorts')) return;
      if (video.paused && video.muted) return;

      const id = previewSubjectId(video);
      if (!id) return;
      if (!Store.isWatched(id) && !Store.has(id)) return;

      if (!video.paused) video.pause();
      video.muted = true;
    });
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
      return;
    }

    overlay.className = 'ytnotes-thumbnail-overlay ytnotes-thumbnail-overlay-cross';
    overlay.textContent = '❌';

    // Your own verdict, handed back to you on the thumbnail. Seeing
    // "Timewaste · Stress" over something is a stronger deterrent than a
    // generic cross.
    const feedback = Store.getFeedback(id);
    if (feedback && feedback.what) {
      const tag = document.createElement('div');
      tag.className = 'ytnotes-thumbnail-verdict';
      tag.textContent = feedback.what + (feedback.why ? ' · ' + feedback.why : '');
      overlay.appendChild(tag);
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

  // A history sync can flip thousands of ids at once. Repaint the feeds,
  // but deliberately leave the player overlay alone: the video already
  // playing must not get blocked halfway through by its own sync.
  Store.onBulkChange(() => processAllThumbnails());

  // Watching something here is news for the other devices. Only
  // locally-originated changes queue a push — echoing a gist pull back
  // at the gist would turn into an endless poll.
  Store.onChange(() => GistSync.schedulePush());

  /* ============================================================
   * YOUTUBE HISTORY SYNC
   *
   * The problem: "watched" was only ever known to the browser that
   * did the watching. Watch something on the phone, on a second
   * Google account, or in a different profile, and this browser had
   * no idea.
   *
   * The fix: YouTube already keeps that list server-side — it is what
   * /feed/history renders. That page is built from the same InnerTube
   * endpoint the YouTube app itself calls:
   *
   *     POST /youtubei/v1/browse   { browseId: "FEhistory" }
   *
   * We are running inside youtube.com with the user's own cookies, so
   * we can call it directly, in the background, no tab and no scraping
   * of a rendered page. The reply is paginated with continuation
   * tokens, so we can walk back as far as we want. Every video id that
   * comes back gets flagged watched in the local store, which is what
   * the ❌ overlays and the player block already read from.
   *
   * Multi-account: signed-in accounts live behind the ?authuser=N /
   * X-Goog-AuthUser header. We probe a few indices, keep the ones that
   * answer, and remember them, so all of your ids sync, not just the
   * one that happens to be active.
   * ============================================================ */

  const HistorySync = (function () {
    const PAGE_WIN = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
    const ORIGIN = 'https://www.youtube.com';
    // Last-resort key: the public WEB InnerTube key. Only used if ytcfg
    // is unreadable (sandboxed window, markup change).
    const FALLBACK_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    // Ids proven to have been watched BEFORE this page load. Deliberately
    // NOT the same thing as "is in the store as watched" — see ingest().
    const historyIds = new Set();
    const accountFingerprints = new Set();

    let firstPassResolve = null;
    let firstPassPromise = new Promise((res) => { firstPassResolve = res; });
    let firstPassSettled = false;
    let syncing = false;

    // The gate waits on "first page of the active account is in", not on
    // the whole deep walk — that is the part that decides whether the
    // video you just opened was already watched somewhere else.
    function armFirstPass() {
      if (!firstPassSettled) return;
      firstPassSettled = false;
      firstPassPromise = new Promise((res) => { firstPassResolve = res; });
    }

    function settleFirstPass() {
      if (firstPassSettled) return;
      firstPassSettled = true;
      try { firstPassResolve(); } catch (e) { /* noop */ }
    }

    /* ---------- meta (its own key: the notes store is keyed by video id,
     *            so anything else living in there could collide) -------- */

    function loadMeta() {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_META_KEY)) || {};
      } catch (e) {
        return {};
      }
    }

    function saveMeta(patch) {
      const meta = Object.assign(loadMeta(), patch);
      try {
        localStorage.setItem(HISTORY_META_KEY, JSON.stringify(meta));
      } catch (e) { /* storage full — the sync still worked, just forgets when */ }
      return meta;
    }

    /* ---------- request plumbing ---------- */

    function readCookie(name) {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return m ? m[1] : null;
    }

    function bytesToHex(buf) {
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // YouTube's own web client signs InnerTube calls with
    // SHA1("<unix ts> <SAPISID> <origin>"). Cookies alone are usually
    // enough, but signing is what makes the personalised (logged-in)
    // response reliable, so do it whenever the cookie is readable.
    async function buildAuthHeader() {
      const sapisid = readCookie('SAPISID') || readCookie('__Secure-3PAPISID') || readCookie('__Secure-1PAPISID');
      if (!sapisid || !window.crypto || !window.crypto.subtle) return null;
      try {
        const ts = Math.floor(Date.now() / 1000);
        const data = new TextEncoder().encode(ts + ' ' + decodeURIComponent(sapisid) + ' ' + ORIGIN);
        const digest = await window.crypto.subtle.digest('SHA-1', data);
        return 'SAPISIDHASH ' + ts + '_' + bytesToHex(digest);
      } catch (e) {
        return null;
      }
    }

    function fromYtcfg(key) {
      try {
        if (PAGE_WIN.ytcfg && typeof PAGE_WIN.ytcfg.get === 'function') {
          const v = PAGE_WIN.ytcfg.get(key);
          if (v) return v;
        }
        if (PAGE_WIN.ytcfg && PAGE_WIN.ytcfg.data_ && PAGE_WIN.ytcfg.data_[key]) {
          return PAGE_WIN.ytcfg.data_[key];
        }
      } catch (e) { /* sandboxed away from the page window */ }
      return null;
    }

    function scrapeFromHtml(re) {
      try {
        const m = document.documentElement.innerHTML.match(re);
        return m ? m[1] : null;
      } catch (e) {
        return null;
      }
    }

    let innertubeCache = null;
    function getInnertube() {
      if (innertubeCache) return innertubeCache;

      const key = fromYtcfg('INNERTUBE_API_KEY')
        || scrapeFromHtml(/"INNERTUBE_API_KEY":"([^"]+)"/)
        || FALLBACK_KEY;

      const clientVersion = fromYtcfg('INNERTUBE_CLIENT_VERSION')
        || scrapeFromHtml(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)
        || '2.20240101.00.00';

      let context = fromYtcfg('INNERTUBE_CONTEXT');
      if (context) {
        // Never mutate ytcfg's own object — YouTube keeps using it.
        try { context = JSON.parse(JSON.stringify(context)); } catch (e) { context = null; }
      }
      if (!context) {
        context = {
          client: {
            clientName: 'WEB',
            clientVersion: clientVersion,
            hl: (document.documentElement.lang || 'en').split('-')[0],
            gl: scrapeFromHtml(/"GL":"([^"]+)"/) || 'US'
          }
        };
        const visitor = scrapeFromHtml(/"visitorData":"([^"]+)"/);
        if (visitor) context.client.visitorData = visitor;
      }

      innertubeCache = {
        key: key,
        context: context,
        clientVersion: (context.client && context.client.clientVersion) || clientVersion,
        visitorData: context.client && context.client.visitorData,
        sessionIndex: Number(fromYtcfg('SESSION_INDEX') || scrapeFromHtml(/"SESSION_INDEX":"?(\d+)"?/) || 0) || 0,
        delegatedSessionId: fromYtcfg('DELEGATED_SESSION_ID') || null
      };
      return innertubeCache;
    }

    async function browse(authUser, continuation) {
      const cfg = getInnertube();
      const context = JSON.parse(JSON.stringify(cfg.context));

      // A delegated session id belongs to the brand account of the
      // *active* profile only — sending it while probing another
      // authuser index asks for a channel that index cannot see.
      const isActive = authUser === cfg.sessionIndex;
      if (!isActive && context.user) delete context.user.onBehalfOfUser;

      const body = continuation
        ? { context: context, continuation: continuation }
        : { context: context, browseId: 'FEhistory' };

      const headers = {
        'Content-Type': 'application/json',
        'X-Goog-AuthUser': String(authUser),
        'X-Origin': ORIGIN,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': cfg.clientVersion
      };
      if (cfg.visitorData) headers['X-Goog-Visitor-Id'] = cfg.visitorData;
      if (isActive && cfg.delegatedSessionId) headers['X-Goog-PageId'] = cfg.delegatedSessionId;

      const auth = await buildAuthHeader();
      if (auth) headers['Authorization'] = auth;

      const res = await fetch(
        ORIGIN + '/youtubei/v1/browse?key=' + encodeURIComponent(cfg.key) + '&prettyPrint=false',
        {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) throw new Error('InnerTube browse failed: HTTP ' + res.status);
      return res.json();
    }

    /* ---------- response parsing ----------
     * Renderer names churn (videoRenderer / lockupViewModel /
     * reelItemRenderer / shortsLockupViewModel ...), so instead of
     * walking a fixed path we sweep the whole payload for video ids in
     * document order. On a history response every id present is, by
     * definition, something that was watched.
     */

    function resumePercent(node) {
      const overlays = node.thumbnailOverlays;
      if (!Array.isArray(overlays)) return null;
      for (const o of overlays) {
        const r = o && o.thumbnailOverlayResumePlaybackRenderer;
        if (r && typeof r.percentDurationWatched === 'number') return r.percentDurationWatched;
      }
      return null;
    }

    function extract(json) {
      const items = [];
      const seen = new Set();
      let nextPageToken = null;

      (function walk(node, type) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (const child of node) walk(child, type);
          return;
        }

        if (typeof node.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(node.videoId) && !seen.has(node.videoId)) {
          seen.add(node.videoId);
          items.push({ id: node.videoId, type: type, percent: resumePercent(node) });
        }

        // The scroll-to-load-more continuation, as opposed to the tokens
        // hanging off filter chips and the history search box.
        const cir = node.continuationItemRenderer;
        if (cir && cir.continuationEndpoint
          && cir.continuationEndpoint.continuationCommand
          && typeof cir.continuationEndpoint.continuationCommand.token === 'string'
          && !nextPageToken
          && (!cir.trigger || cir.trigger === 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN')) {
          nextPageToken = cir.continuationEndpoint.continuationCommand.token;
        }

        for (const k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
          const lower = k.toLowerCase();
          const childType = (lower.indexOf('reel') !== -1 || lower.indexOf('shorts') !== -1) ? 'short' : type;
          walk(node[k], childType);
        }
      })(json, 'video');

      // No continuationItemRenderer means the list ended — or YouTube
      // renamed it. Either way we stop rather than guess at some other
      // token in the payload (filter chips carry their own, and following
      // one bounces between the same two pages forever).
      return { items: items, continuation: nextPageToken };
    }

    /* ---------- ingest ---------- */

    function ingest(items, opts) {
      const keep = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Partial watches: YouTube keeps a resume bar on the history
        // entry. If a minimum has been configured, anything below it
        // does not count as "seen it, skip it".
        if (HISTORY_SYNC.minWatchPercent > 0
          && typeof item.percent === 'number'
          && item.percent < HISTORY_SYNC.minWatchPercent) {
          continue;
        }

        // The video open in this tab right now is already sitting at the
        // top of the server-side history — YouTube logs it the moment
        // playback starts. Counting that as "you watched this before"
        // would slap the ❌ block over a video you just opened, so the
        // newest entry is recorded as watched but not treated as prior
        // history...
        const isSelfAtTop = opts.isNewestPage && i === 0 && item.id === opts.currentVideoId;

        // ...unless it comes back with real progress on it. Playback that
        // began seconds ago cannot be 40% through, so that bar was earned
        // on another device — which is exactly the case worth blocking.
        const progressedElsewhere = isSelfAtTop
          && typeof item.percent === 'number'
          && item.percent >= HISTORY_SYNC.selfTopWatchedPercent;

        if (!isSelfAtTop || progressedElsewhere) historyIds.add(item.id);

        keep.push(item);
      }
      return Store.markWatchedBulk(keep, 'history');
    }

    /* ---------- one account ---------- */

    async function syncAccount(authUser, opts) {
      const current = getCurrentPageVideo();
      const currentVideoId = current ? current.id : null;
      const maxPages = opts.full ? HISTORY_SYNC.maxPagesFull : HISTORY_SYNC.maxPagesIncremental;

      let continuation = null;
      let pages = 0;
      let total = 0;
      let fresh = 0;
      const usedTokens = new Set();

      while (pages < maxPages) {
        const json = await browse(authUser, continuation);
        const parsed = extract(json);

        if (pages === 0) {
          if (!parsed.items.length) return { ok: false, reason: 'empty', total: 0, fresh: 0 };
          // Two indices pointing at the same account (or an index that
          // silently falls back to the default one) return an identical
          // head. Sync it once.
          const fingerprint = parsed.items.slice(0, 5).map((i) => i.id).join(',');
          if (accountFingerprints.has(fingerprint)) return { ok: false, reason: 'duplicate', total: 0, fresh: 0 };
          accountFingerprints.add(fingerprint);
        }

        const added = ingest(parsed.items, {
          isNewestPage: pages === 0 && opts.isActiveAccount,
          currentVideoId: currentVideoId
        });

        total += parsed.items.length;
        fresh += added;
        pages += 1;

        if (opts.isActiveAccount && pages === 1) settleFirstPass();

        // Incremental runs only need to reach the point where the server
        // history and the local store agree again.
        if (!opts.full && added === 0 && opts.baselineDone) break;
        if (!parsed.continuation || usedTokens.has(parsed.continuation)) break;
        usedTokens.add(parsed.continuation);
        continuation = parsed.continuation;

        await new Promise((r) => setTimeout(r, HISTORY_SYNC.pageDelayMs));
      }

      return { ok: true, total: total, fresh: fresh, pages: pages };
    }

    /* ---------- driver ---------- */

    function accountsToTry(meta, full) {
      const cfg = getInnertube();
      const active = cfg.sessionIndex;
      const list = [active];

      if (HISTORY_SYNC.syncAllAccounts) {
        const known = Array.isArray(meta.knownAuthUsers) ? meta.knownAuthUsers : null;
        // Cheap path: re-use the indices that answered last time. Only a
        // full sync pays for re-probing the whole range.
        const candidates = (known && !full)
          ? known
          : Array.from({ length: HISTORY_SYNC.maxAuthUserProbe + 1 }, (_, i) => i);
        for (const i of candidates) {
          if (list.indexOf(i) === -1) list.push(i);
        }
      }
      return list;
    }

    async function run(opts) {
      opts = opts || {};
      if (!HISTORY_SYNC.enabled) { settleFirstPass(); return null; }
      if (syncing) return firstPassPromise;
      syncing = true;
      armFirstPass();

      const meta = loadMeta();
      const full = !!opts.full || !meta.baselineDone;
      if (opts.manual) toast('⟳ Syncing YouTube history…', 8000);

      const answered = [];
      let total = 0;
      let fresh = 0;
      let failure = null;

      try {
        const cfg = getInnertube();
        for (const authUser of accountsToTry(meta, full)) {
          try {
            const res = await syncAccount(authUser, {
              full: full,
              isActiveAccount: authUser === cfg.sessionIndex,
              baselineDone: !!meta.baselineDone
            });
            if (res.ok) {
              answered.push(authUser);
              total += res.total;
              fresh += res.fresh;
            }
          } catch (e) {
            // One dead account index must not abort the others.
            if (authUser === cfg.sessionIndex) failure = e;
            console.warn('[YT Notes] history sync failed for authuser ' + authUser, e);
          }
        }
      } finally {
        syncing = false;
        settleFirstPass();
      }

      const now = Date.now();
      if (answered.length) {
        saveMeta({
          lastSync: now,
          lastError: null,
          baselineDone: meta.baselineDone || full,
          lastFullSync: full ? now : (meta.lastFullSync || 0),
          knownAuthUsers: answered,
          lastSeenCount: total
        });
        if (opts.manual || fresh > 0) {
          toast('✓ History synced — ' + fresh + ' new watched, ' + total + ' checked'
            + (answered.length > 1 ? ' (' + answered.length + ' accounts)' : ''), 4000);
        }
        console.log('[YT Notes] history sync: ' + fresh + ' new / ' + total + ' entries, accounts ' + answered.join(','));
        if (fresh > 0) GistSync.schedulePush();
      } else {
        saveMeta({ lastAttempt: now, lastError: failure ? String(failure.message || failure) : 'no data' });
        if (opts.manual) {
          toast('⚠ History sync failed — are you signed in?', 5000);
        }
        console.warn('[YT Notes] history sync produced nothing.', failure || '');
      }

      return { total: total, fresh: fresh, accounts: answered };
    }

    // Don't re-ask too soon — and back right off if the last attempt came
    // back empty or broken, which is what a signed-out session or a paused
    // watch history looks like.
    function cooldownElapsed(meta) {
      const last = Math.max(meta.lastSync || 0, meta.lastAttempt || 0);
      const wait = meta.lastError ? HISTORY_SYNC.intervalMs : HISTORY_SYNC.staleMs;
      return Date.now() - last >= wait;
    }

    function maybeSync(reason) {
      if (!HISTORY_SYNC.enabled) return null;
      if (syncing) return firstPassPromise;
      if (!cooldownElapsed(loadMeta())) return null;
      console.log('[YT Notes] history sync triggered by: ' + reason);
      run({});
      return firstPassPromise;
    }

    /* ---------- the /feed/history page itself ----------
     * Free, zero-request fallback: if the user is literally looking at
     * their history, every thumbnail on it is a watched video. Covers us
     * if InnerTube ever changes shape underneath.
     */
    function harvestHistoryDom() {
      if (!HISTORY_SYNC.harvestDom) return 0;
      if (location.pathname !== '/feed/history') return 0;

      const current = getCurrentPageVideo();
      const items = [];
      const seen = new Set();
      deepQueryAll(document, THUMBNAIL_LINK_SELECTOR).forEach((anchor) => {
        if (!isThumbnailAnchor(anchor)) return;
        const info = extractIdFromHref(anchor.getAttribute('href'));
        if (!info || seen.has(info.id)) return;
        seen.add(info.id);
        if (current && current.id === info.id) return;
        historyIds.add(info.id);
        items.push(info);
      });
      return items.length ? Store.markWatchedBulk(items, 'history') : 0;
    }

    /* ---------- the bit the player block asks ---------- */

    function gate(id) {
      if (!HISTORY_SYNC.enabled) return Promise.resolve(false);
      // Opening a video is itself a good moment to re-check the server —
      // rate-limited by staleMs, so browsing does not spam InnerTube.
      // On a new device the gist IS the history, so wait for its first
      // pull too — both are capped by the same gate timeout.
      const pending = Promise.all([
        maybeSync('opened-a-video') || firstPassPromise,
        GistSync.ready()
      ]);
      const timeout = new Promise((res) => setTimeout(res, HISTORY_SYNC.firstPageGateMs));
      return Promise.race([pending, timeout]).then(() => historyIds.has(id));
    }

    function start() {
      if (!HISTORY_SYNC.enabled) { settleFirstPass(); return; }

      if (cooldownElapsed(loadMeta())) {
        run({});
      } else {
        // Already fresh from a previous page load; the store carries that
        // knowledge, so there is nothing to wait for.
        settleFirstPass();
      }

      setInterval(() => maybeSync('interval'), HISTORY_SYNC.intervalMs);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) maybeSync('tab-focus');
      });
      window.addEventListener('online', () => maybeSync('back-online'));

      // Watching the history page is itself a sync opportunity.
      const harvest = debounce(harvestHistoryDom, 800);
      document.addEventListener('yt-navigate-finish', harvest);
      setInterval(() => { if (location.pathname === '/feed/history') harvest(); }, 3000);
    }

    return {
      start: start,
      gate: gate,
      // Ids another device proved watched (currently: the gist). They
      // count as prior history for the player block, same as our own.
      addProvenWatched: (ids) => {
        (ids || []).forEach((id) => historyIds.add(id));
      },
      syncNow: () => run({ manual: true }),
      fullResync: () => run({ manual: true, full: true }),
      harvestHistoryDom: harvestHistoryDom,
      meta: loadMeta,
      knownIds: () => historyIds
    };
  })();

  /* ============================================================
   * GIST SYNC — the watched list, shared across every device
   *
   * History sync (above) solves "what did I watch on my phone", but
   * only for accounts YouTube will hand over on this machine. This
   * layer is the other half: a secret GitHub Gist that every device
   * running this script reads from and writes to, so a laptop, a
   * desktop and a second browser profile all agree on what has been
   * seen.
   *
   * Two files, exactly as they sound:
   *
   *     videos.gist   one 11-char video id per line
   *     shorts.gist   one 11-char Shorts id per line
   *
   * Ids only — no titles, no notes, no timestamps — so ~12 bytes per
   * entry. Ten thousand watched videos is about 120 KB, which both
   * localStorage and a gist carry without complaint.
   *
   * Merging is a union, never a replace. That is what makes it safe to
   * run on several machines at once: two devices pushing different new
   * ids cannot clobber each other, and there is no conflict to resolve.
   * The cost of that is that a watched mark cannot be un-shared by
   * deleting it locally — "Overwrite gist from this device" in the panel
   * is the deliberate escape hatch.
   *
   * Setup is one paste of a GitHub token with the `gist` scope. The
   * script finds its own gist if one already exists on the account, and
   * creates it if not, so a new device needs nothing but that token.
   * ============================================================ */

  /* One HTTP entry point.
   *
   * GM_xmlhttpRequest is preferred: it runs outside the page, so no CSP
   * and no CORS preflight can reach it. But the fetch() fallback is a
   * real path, not a token gesture — youtube.com's CSP declares only
   * script-src, object-src and report-uri, with no connect-src and no
   * default-src to inherit from, and api.github.com answers with
   * `access-control-allow-origin: *`. So a plain fetch() to GitHub from
   * a YouTube page genuinely works, which is what lets the whole script
   * run as a bookmarklet (where no GM_* API exists) with gist sync
   * intact. Keep both: if YouTube ever adds a connect-src, the
   * GM_xmlhttpRequest path carries on working. */
  const Net = {
    request({ method = 'GET', url, headers = {}, body = null }) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers,
            data: body,
            timeout: GIST_SYNC.timeoutMs,
            onload: (res) => resolve({ status: res.status, text: res.responseText || '' }),
            onerror: () => reject(new Error(
              'Network error reaching GitHub. Under Tampermonkey, check the stub grants '
              + 'GM_xmlhttpRequest and @connect api.github.com.')),
            ontimeout: () => reject(new Error('GitHub request timed out.'))
          });
          return;
        }
        fetch(url, { method: method, headers: headers, body: body })
          .then((r) => r.text().then((text) => resolve({ status: r.status, text: text })))
          .catch((e) => reject(new Error(
            e.message + ' — could not reach api.github.com. Check the token and your '
            + 'connection; under Tampermonkey, add @grant GM_xmlhttpRequest.')));
      });
    },

    async json(opts) {
      const res = await Net.request(opts);
      let parsed = null;
      try {
        parsed = res.text ? JSON.parse(res.text) : null;
      } catch (e) {
        if (res.status >= 200 && res.status < 300) throw new Error('GitHub returned a non-JSON response.');
      }
      if (res.status < 200 || res.status >= 300) {
        const detail = (parsed && parsed.message) || res.text.slice(0, 200);
        throw new Error('HTTP ' + res.status + ': ' + (detail || 'request failed'));
      }
      return parsed;
    }
  };

  /* The token is a credential, so it goes in Tampermonkey's own storage
   * rather than localStorage, where every script on youtube.com could
   * read it. localStorage is only a fallback for a stub installed
   * without the GM_setValue/GM_getValue grants. */
  const Secrets = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      } catch (e) { /* not granted */ }
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; }
      } catch (e) { /* not granted */ }
      try { localStorage.setItem(key, value); } catch (e) { /* noop */ }
    },
    usingGm() {
      try { return typeof GM_setValue === 'function' && typeof GM_getValue === 'function'; } catch (e) { return false; }
    }
  };

  const GistSync = (function () {
    let firstPullResolve = null;
    const firstPullPromise = new Promise((res) => { firstPullResolve = res; });
    let firstPullSettled = false;
    let syncing = false;
    let pushTimer = null;
    const listeners = new Set();

    function settleFirstPull() {
      if (firstPullSettled) return;
      firstPullSettled = true;
      try { firstPullResolve(); } catch (e) { /* noop */ }
    }

    function config() {
      return {
        token: String(Secrets.get(GIST_KEYS.TOKEN, '') || '').trim(),
        id: String(Secrets.get(GIST_KEYS.ID, '') || '').trim(),
        lastSync: Number(Secrets.get(GIST_KEYS.LAST_SYNC, 0)) || 0,
        login: String(Secrets.get(GIST_KEYS.LOGIN, '') || '')
      };
    }

    function isConfigured() {
      return !!config().token;
    }

    // Set the moment this device learns something new, cleared only by a
    // successful push. A laptop lid closing mid-flight therefore delays
    // the sync rather than losing it — the next page load sees the flag
    // and pushes straight away.
    function markPending() {
      Secrets.set(GIST_KEYS.PENDING, 1);
    }

    function hasPending() {
      return !!Number(Secrets.get(GIST_KEYS.PENDING, 0));
    }

    function headers(token) {
      return {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
    }

    function emit(state) {
      listeners.forEach((fn) => {
        try { fn(state); } catch (e) { /* noop */ }
      });
    }

    /* ---------- file format: comment header + one id per line ---------- */

    function serialise(ids, label) {
      return '# youtubenotes — watched ' + label + ', one id per line\n'
        + '# ' + ids.length + ' entries, updated ' + new Date().toISOString() + '\n'
        + ids.join('\n') + (ids.length ? '\n' : '');
    }

    function parse(text) {
      if (!text) return [];
      const out = [];
      const seen = new Set();
      for (const line of String(text).split('\n')) {
        const id = line.trim();
        if (!id || id.charAt(0) === '#') continue;
        if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    }

    async function readFile(file) {
      if (!file) return [];
      // Gist files over 1 MB come back truncated with a raw_url instead.
      if (file.truncated && file.raw_url) {
        const raw = await Net.request({ method: 'GET', url: file.raw_url });
        return parse(raw.text);
      }
      return parse(file.content);
    }

    /* ---------- finding / creating the gist ---------- */

    function looksLikeOurs(gist) {
      if (!gist || !gist.files) return false;
      const names = Object.keys(gist.files);
      return names.indexOf(GIST_SYNC.videosFile) !== -1 || names.indexOf(GIST_SYNC.shortsFile) !== -1;
    }

    // A new device only gets a token — so before creating anything, look
    // for the gist this account already has.
    async function findExisting(token) {
      for (let page = 1; page <= GIST_SYNC.searchPages; page++) {
        const list = await Net.json({
          method: 'GET',
          url: GIST_SYNC.api + '/gists?per_page=100&page=' + page + '&t=' + Date.now(),
          headers: headers(token)
        });
        if (!Array.isArray(list) || !list.length) return null;
        const match = list.find(looksLikeOurs);
        if (match) return match.id;
        if (list.length < 100) return null;
      }
      return null;
    }

    async function create(token, local) {
      const res = await Net.json({
        method: 'POST',
        url: GIST_SYNC.api + '/gists',
        headers: headers(token),
        body: JSON.stringify({
          description: GIST_SYNC.description,
          public: false,
          files: {
            [GIST_SYNC.videosFile]: { content: serialise(local.videos, 'videos') },
            [GIST_SYNC.shortsFile]: { content: serialise(local.shorts, 'shorts') }
          }
        })
      });
      Secrets.set(GIST_KEYS.ID, res.id);
      return res.id;
    }

    // Resolves to a usable gist id: the remembered one, an existing one on
    // the account, or a freshly created one.
    async function resolveGistId(token, local) {
      const known = config().id;
      if (known) return known;
      const found = await findExisting(token);
      if (found) {
        Secrets.set(GIST_KEYS.ID, found);
        return found;
      }
      return create(token, local);
    }

    /* ---------- the sync itself ---------- */

    async function pull(token, id) {
      const res = await Net.json({
        method: 'GET',
        // Cache-bust, or GitHub's edge can serve a push from another
        // machine back as stale for minutes.
        url: GIST_SYNC.api + '/gists/' + id + '?t=' + Date.now(),
        headers: headers(token)
      });
      const files = res.files || {};
      return {
        videos: await readFile(files[GIST_SYNC.videosFile]),
        shorts: await readFile(files[GIST_SYNC.shortsFile])
      };
    }

    async function push(token, id, merged) {
      await Net.json({
        method: 'PATCH',
        url: GIST_SYNC.api + '/gists/' + id,
        headers: headers(token),
        body: JSON.stringify({
          description: GIST_SYNC.description,
          files: {
            [GIST_SYNC.videosFile]: { content: serialise(merged.videos, 'videos') },
            [GIST_SYNC.shortsFile]: { content: serialise(merged.shorts, 'shorts') }
          }
        })
      });
    }

    function union(remoteIds, localIds) {
      const set = new Set(remoteIds);
      let addedToRemote = 0;
      for (const id of localIds) {
        if (!set.has(id)) { set.add(id); addedToRemote += 1; }
      }
      return { ids: Array.from(set), addedToRemote: addedToRemote };
    }

    /**
     * Pull, merge both directions, push back only if this device knows
     * something the gist does not.
     * @returns {Promise<{pulled:number, pushed:number, videos:number, shorts:number}>}
     */
    async function sync(opts) {
      opts = opts || {};
      if (!GIST_SYNC.enabled) return null;
      if (syncing) return null;

      const { token } = config();
      if (!token) {
        settleFirstPull();
        return null;
      }

      syncing = true;
      emit('syncing');
      if (opts.manual) toast('⟳ Syncing watched list with Gist…', 8000);

      try {
        const local = Store.watchedIds();
        const id = await resolveGistId(token, local);
        const remote = await pull(token, id);

        // Remote → local. Anything the gist knows was watched on some
        // device, which makes it prior history for the block as well.
        const pulled = Store.markWatchedBulk(
          remote.videos.map((v) => ({ id: v, type: 'video' }))
            .concat(remote.shorts.map((s) => ({ id: s, type: 'short' }))),
          'gist'
        );
        HistorySync.addProvenWatched(remote.videos);
        HistorySync.addProvenWatched(remote.shorts);

        // Local → remote.
        const mergedVideos = union(remote.videos, local.videos);
        const mergedShorts = union(remote.shorts, local.shorts);
        const pushed = mergedVideos.addedToRemote + mergedShorts.addedToRemote;

        if (pushed > 0 || opts.force) {
          await push(token, id, { videos: mergedVideos.ids, shorts: mergedShorts.ids });
        }

        Secrets.set(GIST_KEYS.LAST_SYNC, Date.now());
        Secrets.set(GIST_KEYS.LAST_ERROR, '');
        Secrets.set(GIST_KEYS.PENDING, 0);

        const result = {
          pulled: pulled,
          pushed: pushed,
          videos: mergedVideos.ids.length,
          shorts: mergedShorts.ids.length
        };
        if (opts.manual || pulled || pushed) {
          toast('✓ Gist synced — ' + pulled + ' in, ' + pushed + ' out ('
            + result.videos + ' videos, ' + result.shorts + ' shorts)', 4000);
        }
        console.log('[YT Notes] gist sync', result);
        emit('ok');
        return result;
      } catch (e) {
        Secrets.set(GIST_KEYS.LAST_ERROR, String(e.message || e));
        console.warn('[YT Notes] gist sync failed.', e);
        if (opts.manual) toast('⚠ Gist sync failed — ' + (e.message || e), 6000);
        emit('error');
        throw e;
      } finally {
        syncing = false;
        settleFirstPull();
      }
    }

    /* Replaces the gist with exactly what this device has. The only way
     * to shrink the shared list, since ordinary syncs are unions. */
    async function overwriteFromLocal() {
      const { token } = config();
      if (!token) throw new Error('Connect a GitHub token first.');
      const local = Store.watchedIds();
      const id = await resolveGistId(token, local);
      await push(token, id, local);
      Secrets.set(GIST_KEYS.LAST_SYNC, Date.now());
      toast('✓ Gist overwritten — ' + local.videos.length + ' videos, '
        + local.shorts.length + ' shorts', 4000);
      emit('ok');
      return local;
    }

    /* Validates a pasted token, adopts or creates the gist, syncs once. */
    async function connect(token) {
      const clean = String(token || '').trim();
      if (!clean) throw new Error('Paste a token first.');

      const user = await Net.json({
        method: 'GET',
        url: GIST_SYNC.api + '/user',
        headers: headers(clean)
      });

      Secrets.set(GIST_KEYS.TOKEN, clean);
      Secrets.set(GIST_KEYS.LOGIN, user.login || '');
      emit('syncing');

      const result = await sync({ manual: true });
      return { login: user.login, result: result };
    }

    function disconnect() {
      Secrets.set(GIST_KEYS.TOKEN, '');
      Secrets.set(GIST_KEYS.ID, '');
      Secrets.set(GIST_KEYS.LOGIN, '');
      Secrets.set(GIST_KEYS.LAST_SYNC, 0);
      Secrets.set(GIST_KEYS.LAST_ERROR, '');
      emit('idle');
    }

    /* New ids trickle in constantly (every video you open, every history
     * sync). Batch them instead of a PATCH per video. */
    function schedulePush() {
      if (!GIST_SYNC.enabled || !isConfigured()) return;
      markPending();
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        sync({}).catch(() => { /* reported and toasted inside sync() */ });
      }, GIST_SYNC.pushDebounceMs);
    }

    // Anything that looks like the session ending — tab hidden, page
    // being torn down, window blurred — is a reason to stop waiting out
    // the debounce and push now, while the page is still alive enough to
    // make the request.
    function flush(reason) {
      if (!GIST_SYNC.enabled || !isConfigured()) return;
      if (!hasPending() || syncing) return;
      clearTimeout(pushTimer);
      console.log('[YT Notes] flushing gist push: ' + reason);
      sync({}).catch(() => { /* already handled */ });
    }

    function maybeSync(reason) {
      if (!GIST_SYNC.enabled || !isConfigured() || syncing) return;
      const since = Date.now() - config().lastSync;
      if (since < GIST_SYNC.staleMs) return;
      console.log('[YT Notes] gist sync triggered by: ' + reason);
      sync({}).catch(() => { /* already handled */ });
    }

    // The block on a freshly opened video waits for this too: on a new
    // device the gist IS the watch history.
    function ready() {
      if (!GIST_SYNC.enabled || !isConfigured()) return Promise.resolve();
      return firstPullPromise;
    }

    function start() {
      if (!GIST_SYNC.enabled) { settleFirstPull(); return; }
      if (!isConfigured()) { settleFirstPull(); return; }

      if (hasPending()) console.log('[YT Notes] gist has unpushed changes from a previous session.');
      sync({}).catch(() => { /* already handled */ });
      setInterval(() => maybeSync('interval'), GIST_SYNC.intervalMs);

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flush('tab-hidden');
        else maybeSync('tab-focus');
      });
      // pagehide fires on tab close, navigation and iOS app switches;
      // freeze is Chrome telling us the tab is about to be suspended.
      window.addEventListener('pagehide', () => flush('page-hide'));
      window.addEventListener('blur', () => flush('window-blur'));
      document.addEventListener('freeze', () => flush('tab-freeze'));
      window.addEventListener('online', () => maybeSync('back-online'));
    }

    return {
      start: start,
      ready: ready,
      sync: sync,
      syncNow: () => sync({ manual: true }),
      connect: connect,
      disconnect: disconnect,
      overwriteFromLocal: overwriteFromLocal,
      schedulePush: schedulePush,
      flush: flush,
      hasPending: hasPending,
      config: config,
      isConfigured: isConfigured,
      isSyncing: () => syncing,
      lastError: () => String(Secrets.get(GIST_KEYS.LAST_ERROR, '') || ''),
      onState: (fn) => listeners.add(fn)
    };
  })();

  /* ============================================================
   * GIST UI — the floating button and its panel
   *
   * One round button in the corner of every YouTube page. Click it and
   * it asks for a GitHub token; from there it finds or creates the gist
   * and syncs, so setting up a new device is: paste token, done.
   * ============================================================ */

  const GistUI = (function () {
    let root = null;
    let fab = null;
    let panel = null;
    let open = false;
    let watchdog = null;
    const POS_KEY = 'ytnotes_fabPos';
    const FAB_SIZE = 38;
    const EDGE = 12;

    function h(tag, props, children) {
      const el = document.createElement(tag);
      Object.assign(el, props || {});
      (children || []).forEach((child) => {
        el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
      return el;
    }

    // Where the token actually ends up. A bookmarklet shims GM_setValue on
    // top of localStorage, so "stored by Tampermonkey" would be a lie there
    // — and it is the one sentence that has to be true.
    function storageLabel() {
      try {
        if (typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler === 'bookmarklet') {
          return "in this browser's localStorage (bookmarklet mode)";
        }
      } catch (e) { /* no GM_info at all */ }
      return Secrets.usingGm() ? 'by Tampermonkey' : "in this browser's localStorage";
    }

    function relativeTime(ts) {
      if (!ts) return 'never';
      const secs = Math.round((Date.now() - ts) / 1000);
      if (secs < 60) return 'just now';
      if (secs < 3600) return Math.round(secs / 60) + ' min ago';
      if (secs < 86400) return Math.round(secs / 3600) + ' h ago';
      return Math.round(secs / 86400) + ' d ago';
    }

    function setStatus(text, kind) {
      const el = panel && panel.querySelector('.ytnotes-gist-status');
      if (!el) return;
      el.textContent = text || '';
      el.className = 'ytnotes-gist-status' + (kind ? ' ytnotes-gist-' + kind : '');
    }

    function paintFab() {
      if (!fab) return;
      const dot = fab.querySelector('.ytnotes-gist-dot');
      if (!dot) return;
      let state = 'off';
      if (GistSync.isSyncing()) state = 'busy';
      else if (GistSync.isConfigured()) state = GistSync.lastError() ? 'bad' : 'on';
      dot.className = 'ytnotes-gist-dot ytnotes-gist-dot-' + state;
      if (root) root.classList.toggle('ytnotes-gist-setup', state === 'off');
      fab.title = state === 'on' ? 'Watched list synced to Gist'
        : state === 'busy' ? 'Syncing watched list…'
          : state === 'bad' ? 'Gist sync error — click for details'
            : 'Sync your watched list across devices';
    }

    /* ---------- panel bodies ---------- */

    function buildDisconnected(body) {
      const tokenUrl = 'https://github.com/settings/tokens/new?scopes=gist&description=youtubenotes+watched+sync';

      body.appendChild(h('p', { className: 'ytnotes-gist-copy' }, [
        'Keep one watched list across every device. Ids are stored in a secret '
        + 'Gist as ' + GIST_SYNC.videosFile + ' and ' + GIST_SYNC.shortsFile + '.'
      ]));

      body.appendChild(h('a', {
        className: 'ytnotes-gist-link',
        href: tokenUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: 'Create a token with the “gist” scope →'
      }));

      const input = h('input', {
        className: 'ytnotes-gist-input',
        type: 'password',
        placeholder: 'Paste your GitHub token',
        autocomplete: 'off',
        spellcheck: false
      });
      // YouTube binds single-key shortcuts on document; without this,
      // typing a token would seek and mute the player.
      ['keydown', 'keyup', 'keypress'].forEach((evt) => {
        input.addEventListener(evt, (e) => {
          e.stopPropagation();
          if (evt === 'keydown' && e.key === 'Enter') connect(input.value);
        });
      });
      body.appendChild(input);

      const btn = h('button', { className: 'ytnotes-gist-btn', textContent: 'Connect' });
      btn.addEventListener('click', () => connect(input.value));
      body.appendChild(btn);

      body.appendChild(h('p', { className: 'ytnotes-gist-fine' }, [
        'The gist is created for you if you do not have one yet, and reused if you do. '
        + 'The token is stored ' + storageLabel() + ', and only ever sent to api.github.com.'
      ]));

      setTimeout(() => input.focus(), 50);
    }

    function buildConnected(body) {
      const cfg = GistSync.config();
      const counts = Store.watchedIds();

      const rows = [
        ['Account', cfg.login ? '@' + cfg.login : 'connected'],
        ['Videos', String(counts.videos.length)],
        ['Shorts', String(counts.shorts.length)],
        ['Last sync', relativeTime(cfg.lastSync)]
      ];
      const table = h('div', { className: 'ytnotes-gist-rows' });
      rows.forEach(([k, v]) => {
        table.appendChild(h('div', { className: 'ytnotes-gist-row' }, [
          h('span', { className: 'ytnotes-gist-k', textContent: k }),
          h('span', { className: 'ytnotes-gist-v', textContent: v })
        ]));
      });
      body.appendChild(table);

      if (cfg.id) {
        body.appendChild(h('a', {
          className: 'ytnotes-gist-link',
          href: 'https://gist.github.com/' + cfg.id,
          target: '_blank',
          rel: 'noopener noreferrer',
          textContent: 'Open the gist →'
        }));
      }

      const actions = h('div', { className: 'ytnotes-gist-actions' });

      const syncBtn = h('button', { className: 'ytnotes-gist-btn', textContent: 'Sync now' });
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        setStatus('Syncing…', null);
        paintFab();
        try {
          const r = await GistSync.syncNow();
          setStatus(r ? 'Pulled ' + r.pulled + ', pushed ' + r.pushed + '.' : 'Nothing to do.', 'ok');
          render();
        } catch (e) {
          setStatus(String(e.message || e), 'bad');
        } finally {
          syncBtn.disabled = false;
          paintFab();
        }
      });
      actions.appendChild(syncBtn);

      const outBtn = h('button', { className: 'ytnotes-gist-btn ytnotes-gist-btn-sec', textContent: 'Disconnect' });
      outBtn.addEventListener('click', () => {
        GistSync.disconnect();
        render();
        paintFab();
      });
      actions.appendChild(outBtn);
      body.appendChild(actions);

      // Ordinary syncs are unions, so the shared list only ever grows.
      // This is the deliberate way to make it shrink.
      const overwrite = h('button', {
        className: 'ytnotes-gist-textbtn',
        textContent: 'Overwrite gist with this device’s list'
      });
      overwrite.addEventListener('click', async () => {
        const msg = 'Replace the gist with exactly what this device has ('
          + counts.videos.length + ' videos, ' + counts.shorts.length + ' shorts)?\n\n'
          + 'Ids that only exist on your other devices will be removed from the gist.';
        if (!confirm(msg)) return;
        setStatus('Overwriting…', null);
        try {
          await GistSync.overwriteFromLocal();
          setStatus('Gist now matches this device.', 'ok');
          render();
        } catch (e) {
          setStatus(String(e.message || e), 'bad');
        }
      });
      body.appendChild(overwrite);

      const err = GistSync.lastError();
      if (err) setTimeout(() => setStatus(err, 'bad'), 0);
    }

    async function connect(token) {
      setStatus('Checking token…', null);
      paintFab();
      try {
        const { login } = await GistSync.connect(token);
        setStatus('Connected as @' + login + '.', 'ok');
        render();
      } catch (e) {
        setStatus(String(e.message || e), 'bad');
      }
      paintFab();
    }

    /* ---------- shell ---------- */

    function render() {
      if (!panel) return;
      panel.textContent = '';

      const head = h('div', { className: 'ytnotes-gist-head' }, [
        h('span', { className: 'ytnotes-gist-title', textContent: 'Watched list sync' })
      ]);
      const close = h('button', { className: 'ytnotes-gist-close', textContent: '✕', title: 'Close' });
      close.addEventListener('click', () => toggle(false));
      head.appendChild(close);
      panel.appendChild(head);

      const body = h('div', { className: 'ytnotes-gist-body' });
      panel.appendChild(body);

      if (GistSync.isConfigured()) buildConnected(body);
      else buildDisconnected(body);

      panel.appendChild(h('div', { className: 'ytnotes-gist-status' }));
    }

    function toggle(next) {
      open = typeof next === 'boolean' ? next : !open;
      if (!panel) return;
      if (open) {
        render();
        placePanel();
      }
      panel.classList.toggle('ytnotes-gist-panel-open', open);
    }

    function onDocumentClick(e) {
      if (!open) return;
      if (root && root.contains(e.target)) return;
      toggle(false);
    }

    /* ---------- position: draggable, remembered, always on screen ---------- */

    function loadPos() {
      try {
        const saved = JSON.parse(localStorage.getItem(POS_KEY));
        if (saved && typeof saved.rx === 'number' && typeof saved.ry === 'number') return saved;
      } catch (e) { /* noop */ }
      return { rx: 1, ry: 1 }; // bottom-right until moved
    }

    let pos = loadPos();

    function savePos() {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) { /* noop */ }
    }

    // Ratios rather than pixels, so the button keeps its corner when the
    // window is resized or the video goes fullscreen.
    function applyPos() {
      if (!root) return;
      const maxX = Math.max(EDGE, window.innerWidth - FAB_SIZE - EDGE);
      const maxY = Math.max(EDGE, window.innerHeight - FAB_SIZE - EDGE);
      const x = Math.min(maxX, Math.max(EDGE, pos.rx * (window.innerWidth - FAB_SIZE)));
      const y = Math.min(maxY, Math.max(EDGE, pos.ry * (window.innerHeight - FAB_SIZE)));
      root.style.left = Math.round(x) + 'px';
      root.style.top = Math.round(y) + 'px';
      root.classList.toggle('ytnotes-gist-onleft', x < window.innerWidth / 2);
    }

    // Open the panel towards whichever side has room for it.
    function placePanel() {
      if (!root || !panel) return;
      const rect = root.getBoundingClientRect();
      panel.classList.toggle('ytnotes-gist-panel-right', rect.left < window.innerWidth / 2);
      panel.classList.toggle('ytnotes-gist-panel-left', rect.left >= window.innerWidth / 2);
      panel.classList.toggle('ytnotes-gist-panel-down', rect.top < window.innerHeight / 2);
      panel.classList.toggle('ytnotes-gist-panel-up', rect.top >= window.innerHeight / 2);
    }

    function makeDraggable() {
      let startX = 0, startY = 0, originX = 0, originY = 0;
      let dragging = false, moved = false;

      fab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = root.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
        try { fab.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        e.preventDefault();
        e.stopPropagation();
      });

      fab.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // A few pixels of slop, so a slightly shaky click is still a click.
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        root.classList.add('ytnotes-gist-dragging');
        const x = Math.min(window.innerWidth - FAB_SIZE - EDGE, Math.max(EDGE, originX + dx));
        const y = Math.min(window.innerHeight - FAB_SIZE - EDGE, Math.max(EDGE, originY + dy));
        root.style.left = Math.round(x) + 'px';
        root.style.top = Math.round(y) + 'px';
        pos = {
          rx: x / Math.max(1, window.innerWidth - FAB_SIZE),
          ry: y / Math.max(1, window.innerHeight - FAB_SIZE)
        };
        if (open) placePanel();
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        root.classList.remove('ytnotes-gist-dragging');
        try { fab.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
        if (moved) { savePos(); return; }
        toggle();          // never moved => it was a click
      }
      fab.addEventListener('pointerup', endDrag);
      fab.addEventListener('pointercancel', () => { dragging = false; });
    }

    /* ---------- fullscreen ----------
     * A fullscreened video renders only that element's subtree, so a
     * button parented to <body> vanishes (or sits under the player,
     * unclickable). Move ourselves inside whatever went fullscreen.
     */
    function reparentForFullscreen() {
      if (!root) return;
      const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
      if (root.parentElement !== host) host.appendChild(root);
      applyPos();
      if (open) placePanel();
    }

    function mount() {
      if (!GIST_SYNC.enabled || !GIST_SYNC.showButton) return;
      if (!document.body || document.querySelector('.ytnotes-gist-fab')) return;

      fab = h('button', { className: 'ytnotes-gist-fab', title: 'Drag to move · click to open' }, [
        h('span', { className: 'ytnotes-gist-glyph', textContent: '⇅' }),
        h('span', { className: 'ytnotes-gist-dot' })
      ]);
      panel = h('div', { className: 'ytnotes-gist-panel' });
      // Until a token is connected this button is the ONLY way into gist
      // sync (a bookmarklet has no Tampermonkey menu), so it has to read as
      // a call to action, not as a scroll widget in the corner.
      const hint = h('span', { className: 'ytnotes-gist-hint', textContent: 'Connect Gist' });
      hint.addEventListener('click', (e) => { e.stopPropagation(); toggle(true); });
      root = h('div', { className: 'ytnotes-gist-root' }, [hint, fab, panel]);

      document.body.appendChild(root);
      applyPos();
      makeDraggable();

      document.addEventListener('click', onDocumentClick, true);
      window.addEventListener('resize', applyPos);
      ['fullscreenchange', 'webkitfullscreenchange'].forEach((evt) => {
        document.addEventListener(evt, reparentForFullscreen);
      });

      GistSync.onState(() => { paintFab(); });
      paintFab();

      // YouTube replaces large parts of the DOM on navigation; if the
      // button goes with it, put it back. One watchdog, not one per mount.
      if (!watchdog) {
        watchdog = setInterval(() => {
          if (!document.querySelector('.ytnotes-gist-fab')) {
            root = null;
            fab = null;
            panel = null;
            open = false;
            mount();
          } else {
            // Entering fullscreen does not always fire an event we caught.
            reparentForFullscreen();
          }
        }, 5000);
      }
    }

    return { mount: mount, toggle: toggle, repaint: paintFab };
  })();

  /* ============================================================
   * REFLECTION — the deliberate speed bump
   *
   * Short videos are where the mindless scrolling happens, so anything
   * under ten minutes (and every Short) costs one question when you
   * leave it: what was that, and why did you watch it.
   *
   * Three design rules, all of them load-bearing:
   *
   *   1. Three seconds, then two taps. Long enough to interrupt the
   *      autopilot, short enough that nobody reaches for an incognito
   *      window to escape it.
   *   2. Nothing lands in the same place twice. Option order, the card
   *      position and the chip offsets are all re-rolled every time,
   *      because a fixed layout becomes muscle memory within a day and
   *      muscle memory is exactly what this is trying to interrupt.
   *   3. Skipping costs more than answering — "not now" only appears
   *      after six seconds, twice the wait of just answering.
   *
   * The queue is written to storage the moment a video ends, so closing
   * the laptop mid-scroll postpones the question rather than dodging it.
   * ============================================================ */

  const Reflection = (function () {
    const QUEUE_KEY = 'ytPersonalNotes_reflectQueue_v1';

    let activeId = null;
    let activeType = 'video';
    let activeSince = 0;
    let activeDuration = 0;
    let activeTitle = '';
    let modal = null;
    let answered = null;

    function loadQueue() {
      try {
        const raw = JSON.parse(localStorage.getItem(QUEUE_KEY));
        return Array.isArray(raw) ? raw : [];
      } catch (e) {
        return [];
      }
    }

    function saveQueue(q) {
      try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, REFLECTION.maxQueued))); } catch (e) { /* noop */ }
    }

    let queue = loadQueue();

    function shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }

    /* ---------- watching ---------- */

    function mainVideoEl() {
      return document.querySelector('#movie_player video')
        || document.querySelector('ytd-reel-video-renderer[is-active] video')
        || document.querySelector('video.html5-main-video')
        || document.querySelector('video');
    }

    // "12:34" / "1:02:03" -> seconds
    function parseClock(text) {
      const parts = String(text || '').trim().split(':');
      if (parts.length < 2 || parts.length > 3) return 0;
      let total = 0;
      for (const part of parts) {
        const n = Number(part);
        if (!isFinite(n)) return 0;
        total = total * 60 + n;
      }
      return total;
    }

    function sample() {
      const el = mainVideoEl();
      if (el && isFinite(el.duration) && el.duration > 0) {
        activeDuration = Math.max(activeDuration, el.duration);
      } else {
        // Metadata is not always loaded by the time you leave. The player
        // chrome shows the length regardless.
        const clock = document.querySelector('#movie_player .ytp-time-duration');
        const seconds = clock ? parseClock(clock.textContent) : 0;
        if (seconds > 0) activeDuration = Math.max(activeDuration, seconds);
      }
      const t = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim();
      if (t && t !== 'YouTube') activeTitle = t;
    }

    // Shorts always count. Ordinary videos only when they are genuinely
    // short-form — a two-hour talk is not what this is for. An unknown
    // duration is left alone rather than guessed at.
    function qualifies() {
      if (!activeId) return false;
      if (Date.now() - activeSince < REFLECTION.minWatchSeconds * 1000) return false;
      if (Store.getFeedback(activeId)) return false;
      if (queue.some((q) => q.id === activeId)) return false;
      if (activeType === 'short') return !!REFLECTION.includeShorts;
      // Unknown duration asks anyway. Staying silent whenever the length
      // could not be read is what made this never fire: click a video,
      // leave before metadata loads, and it counted as "not short-form".
      // Only a duration we actually measured can veto the question.
      if (activeDuration && activeDuration > REFLECTION.maxDurationSeconds) return false;
      return true;
    }

    // Why the last video did or did not get asked about. Surfaced through
    // YTNotes.reflection.debug() so this is never guesswork again.
    let lastDecision = 'nothing watched yet';

    function decide() {
      if (!activeId) return 'no video open';
      const heldFor = (Date.now() - activeSince) / 1000;
      if (heldFor < REFLECTION.minWatchSeconds) {
        return 'skipped: only ' + heldFor.toFixed(1) + 's, under minWatchSeconds (' + REFLECTION.minWatchSeconds + ')';
      }
      if (Store.getFeedback(activeId)) return 'skipped: already answered for ' + activeId;
      if (queue.some((q) => q.id === activeId)) return 'skipped: already queued';
      if (activeType !== 'short' && activeDuration && activeDuration > REFLECTION.maxDurationSeconds) {
        return 'skipped: ' + Math.round(activeDuration) + 's long, over maxDurationSeconds';
      }
      return 'queued ' + activeId + ' (' + activeType + ', held ' + heldFor.toFixed(1) + 's, duration '
        + (activeDuration ? Math.round(activeDuration) + 's' : 'unknown') + ')';
    }

    function closeOut() {
      if (activeId) {
        lastDecision = decide();
        console.log('[YT Notes] reflection: ' + lastDecision);
      }
      if (qualifies()) {
        queue.push({
          id: activeId,
          type: activeType,
          title: activeTitle,
          seconds: Math.round((Date.now() - activeSince) / 1000),
          at: Date.now()
        });
        saveQueue(queue);
      }
      activeId = null;
      activeDuration = 0;
      activeTitle = '';
    }

    function tick() {
      if (!REFLECTION.enabled) return;
      const current = getCurrentPageVideo();
      const id = current ? current.id : null;

      if (id !== activeId) {
        closeOut();
        if (id) {
          activeId = id;
          activeType = current.type;
          activeSince = Date.now();
          activeDuration = 0;
          activeTitle = '';
        }
      } else if (activeId) {
        sample();
      }

      showNext();
    }

    /* ---------- playback while the card is up ---------- */

    function pausePlayback() {
      document.querySelectorAll('video').forEach((v) => {
        if (v.paused) return;
        v.pause();
        v._ytreflectPaused = true;
      });
    }

    function resumePlayback() {
      document.querySelectorAll('video').forEach((v) => {
        if (!v._ytreflectPaused) return;
        delete v._ytreflectPaused;
        // Leave it paused if the "already watched" block still wants it.
        if (!v._ytnotesPaused && v.paused) v.play().catch(() => {});
      });
    }

    /* ---------- the card ---------- */

    function place(card) {
      if (!REFLECTION.randomisePlacement) return;
      // Keep it fully on screen at any window size, but never twice in
      // the same spot.
      const left = 6 + Math.random() * 44;   // vw
      const top = 10 + Math.random() * 42;   // vh
      card.style.left = left.toFixed(2) + 'vw';
      card.style.top = top.toFixed(2) + 'vh';
      card.style.right = 'auto';
      card.style.bottom = 'auto';
    }

    function chipRow(options, onPick) {
      const row = document.createElement('div');
      row.className = 'ytnotes-reflect-row';
      shuffle(options).forEach((label) => {
        const chip = document.createElement('button');
        chip.className = 'ytnotes-reflect-chip';
        chip.textContent = label;
        chip.disabled = true;
        if (REFLECTION.randomisePlacement) {
          // Sub-pixel-stable but never identical: the chips shift enough
          // that a remembered click position lands on nothing.
          chip.style.marginLeft = Math.floor(Math.random() * 26) + 'px';
          chip.style.marginTop = Math.floor(Math.random() * 10) + 'px';
          chip.style.order = String(Math.floor(Math.random() * 100));
        }
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          if (chip.disabled) return;
          onPick(label);
        });
        row.appendChild(chip);
      });
      return row;
    }

    function enableChips(card) {
      card.querySelectorAll('.ytnotes-reflect-chip').forEach((c) => { c.disabled = false; });
    }

    function buildCard(entry) {
      const card = document.createElement('div');
      card.className = 'ytnotes-reflect-card';
      place(card);

      const kind = entry.type === 'short' ? 'Short' : 'Video';
      const head = document.createElement('div');
      head.className = 'ytnotes-reflect-head';
      head.textContent = 'You just watched a ' + kind
        + (entry.seconds ? ' for ' + entry.seconds + 's' : '');
      card.appendChild(head);

      if (entry.title) {
        const title = document.createElement('div');
        title.className = 'ytnotes-reflect-title';
        title.textContent = entry.title;
        card.appendChild(title);
      }

      const question = document.createElement('div');
      question.className = 'ytnotes-reflect-q';
      card.appendChild(question);

      const slot = document.createElement('div');
      slot.className = 'ytnotes-reflect-slot';
      card.appendChild(slot);

      const foot = document.createElement('div');
      foot.className = 'ytnotes-reflect-foot';
      card.appendChild(foot);

      return { card, question, slot, foot };
    }

    function showNext() {
      if (modal || !queue.length || !REFLECTION.enabled || !document.body) return;

      const entry = queue[0];
      answered = { what: null, why: null };

      modal = document.createElement('div');
      modal.className = 'ytnotes-reflect-backdrop';
      // Swallow clicks on the backdrop: there is no clicking past this.
      modal.addEventListener('click', (e) => { e.stopPropagation(); });

      const parts = buildCard(entry);
      modal.appendChild(parts.card);
      // A fullscreen video renders only its own subtree, so a card
      // parented to <body> would be invisible — and the question would
      // silently never appear, which is the worst possible failure here.
      (document.fullscreenElement || document.webkitFullscreenElement || document.body).appendChild(modal);
      pausePlayback();

      function finish() {
        Store.setFeedback(entry.id, { what: answered.what, why: answered.why, at: Date.now() });
        queue.shift();
        saveQueue(queue);
        dismiss();
        toast('Logged: ' + answered.what + ' · ' + answered.why, 2500);
      }

      function dismiss() {
        if (modal) modal.remove();
        modal = null;
        resumePlayback();
      }

      function askWhy() {
        parts.question.textContent = 'Why did you watch it?';
        parts.slot.textContent = '';
        parts.slot.appendChild(chipRow(REFLECTION.whyOptions, (label) => {
          answered.why = label;
          finish();
        }));
        place(parts.card);           // move again between questions
        enableChips(parts.card);     // no second wait — the 3s was the toll
      }

      parts.question.textContent = 'What was that?';
      parts.slot.appendChild(chipRow(REFLECTION.whatOptions, (label) => {
        answered.what = label;
        askWhy();
      }));

      // The toll: chips are dead for three seconds.
      let left = REFLECTION.pauseSeconds;
      parts.foot.textContent = left + '…';
      const countdown = setInterval(() => {
        left -= 1;
        if (left > 0) {
          parts.foot.textContent = left + '…';
          return;
        }
        clearInterval(countdown);
        parts.foot.textContent = '';
        enableChips(parts.card);
      }, 1000);

      // Skipping is always available, just slower than answering.
      setTimeout(() => {
        if (!modal) return;
        const skip = document.createElement('button');
        skip.className = 'ytnotes-reflect-skip';
        skip.textContent = 'not now';
        skip.addEventListener('click', (e) => {
          e.stopPropagation();
          queue.shift();
          saveQueue(queue);
          clearInterval(countdown);
          dismiss();
        });
        parts.foot.appendChild(skip);
      }, REFLECTION.skipAfterSeconds * 1000);
    }

    /* ---------- leaving the page counts as leaving the video ---------- */

    function flush() {
      if (!REFLECTION.enabled) return;
      sample();
      closeOut();
    }

    function start() {
      if (!REFLECTION.enabled) return;
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flush();
      });
    }

    function summary() {
      const all = Store.allFeedback();
      const what = {};
      const why = {};
      all.forEach((f) => {
        what[f.what] = (what[f.what] || 0) + 1;
        why[f.why] = (why[f.why] || 0) + 1;
      });
      return { answered: all.length, pending: queue.length, what: what, why: why };
    }

    return {
      start: start,
      tick: tick,
      summary: summary,
      queued: () => queue.length,
      debug: () => ({
        enabled: REFLECTION.enabled,
        watchingNow: activeId,
        type: activeType,
        heldForSeconds: activeId ? Math.round((Date.now() - activeSince) / 10) / 100 : 0,
        durationSeconds: activeDuration || 'unknown',
        lastDecision: lastDecision,
        queued: queue.map((q) => q.id),
        cardShowing: !!modal,
        thresholds: {
          minWatchSeconds: REFLECTION.minWatchSeconds,
          maxDurationSeconds: REFLECTION.maxDurationSeconds,
          includeShorts: REFLECTION.includeShorts
        }
      }),
      // Ask about the current video right now, without waiting to leave it.
      askNow: () => {
        sample();
        const forced = activeId;
        if (!forced) return false;
        if (!queue.some((q) => q.id === forced)) {
          queue.push({
            id: forced,
            type: activeType,
            title: activeTitle,
            seconds: Math.round((Date.now() - activeSince) / 1000),
            at: Date.now()
          });
          saveQueue(queue);
        }
        showNext();
        return true;
      }
    };
  })();

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
      .ytnotes-toast {
        position: fixed !important;
        left: 16px;
        bottom: 16px;
        z-index: 2147483646;
        max-width: 320px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(15, 15, 15, 0.92);
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.18);
        font: 500 12px/1.3 "Roboto", Arial, sans-serif;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
        cursor: pointer;
        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .ytnotes-toast-show {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .ytnotes-gist-root {
        position: fixed !important;
        z-index: 2147483645;
        width: 38px;
        height: 38px;
      }
      .ytnotes-gist-dragging { opacity: 0.85; }
      .ytnotes-gist-fab {
        position: relative;
        touch-action: none;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(15, 15, 15, 0.86);
        color: #f1f1f1;
        cursor: pointer;
        opacity: 0.45;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .ytnotes-gist-fab:hover { opacity: 1; transform: scale(1.06); }

      /* not connected yet: loud, labelled, impossible to mistake */
      .ytnotes-gist-setup .ytnotes-gist-fab {
        opacity: 1;
        background: #ff0033;
        border-color: rgba(255, 255, 255, 0.9);
        box-shadow: 0 4px 16px rgba(255, 0, 51, 0.45);
        animation: ytnotes-gist-pulse 2.4s ease-in-out infinite;
      }
      @keyframes ytnotes-gist-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 0, 51, 0.55); }
        50%      { box-shadow: 0 0 0 9px rgba(255, 0, 51, 0); }
      }
      .ytnotes-gist-hint {
        display: none;
        position: absolute;
        top: 50%;
        right: 46px;
        transform: translateY(-50%);
        white-space: nowrap;
        padding: 6px 10px;
        border-radius: 999px;
        background: #0f0f0f;
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.25);
        font: 600 12px/1 "Roboto", Arial, sans-serif;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        cursor: pointer;
      }
      .ytnotes-gist-onleft .ytnotes-gist-hint { right: auto; left: 46px; }
      .ytnotes-gist-setup .ytnotes-gist-hint { display: block; }
      .ytnotes-gist-dragging .ytnotes-gist-fab { opacity: 1; cursor: grabbing; }
      .ytnotes-gist-glyph { font-size: 17px; line-height: 1; }
      .ytnotes-gist-dot {
        position: absolute;
        right: 4px;
        bottom: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.55);
      }
      .ytnotes-gist-dot-off  { background: #909090; }
      .ytnotes-gist-dot-on   { background: #2ba640; }
      .ytnotes-gist-dot-bad  { background: #ff4e45; }
      .ytnotes-gist-dot-busy { background: #3ea6ff; }

      .ytnotes-gist-panel {
        position: absolute;
        width: 300px;
        max-width: calc(100vw - 32px);
        max-height: min(70vh, 560px);
        overflow-y: auto;
        display: none;
        padding: 14px;
        border-radius: 12px;
        background: #212121;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
        font: 400 13px/1.45 "Roboto", Arial, sans-serif;
      }
      .ytnotes-gist-panel-open { display: block; }
      .ytnotes-gist-panel-up { bottom: 46px; }
      .ytnotes-gist-panel-down { top: 46px; }
      .ytnotes-gist-panel-left { right: 0; }
      .ytnotes-gist-panel-right { left: 0; }
      .ytnotes-gist-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .ytnotes-gist-title { font-weight: 700; font-size: 14px; }
      .ytnotes-gist-close {
        background: none;
        border: none;
        color: #aaa;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
      }
      .ytnotes-gist-close:hover { color: #fff; }
      .ytnotes-gist-copy { margin: 0 0 10px; color: #cfcfcf; }
      .ytnotes-gist-fine { margin: 10px 0 0; color: #909090; font-size: 11px; line-height: 1.4; }
      .ytnotes-gist-link {
        display: block;
        margin-bottom: 10px;
        color: #3ea6ff;
        text-decoration: none;
        font-size: 12px;
      }
      .ytnotes-gist-link:hover { text-decoration: underline; }
      .ytnotes-gist-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        margin-bottom: 8px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: #121212;
        color: #f1f1f1;
        font: 400 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
        outline: none;
      }
      .ytnotes-gist-input:focus { border-color: #3ea6ff; }
      .ytnotes-gist-btn {
        flex: 1 1 auto;
        padding: 8px 12px;
        border-radius: 999px;
        border: none;
        background: #f1f1f1;
        color: #0f0f0f;
        font: 700 12px/1 "Roboto", Arial, sans-serif;
        cursor: pointer;
      }
      .ytnotes-gist-btn:hover { background: #fff; }
      .ytnotes-gist-btn:disabled { opacity: 0.5; cursor: default; }
      .ytnotes-gist-btn-sec {
        background: transparent;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.25);
      }
      .ytnotes-gist-btn-sec:hover { background: rgba(255, 255, 255, 0.08); }
      .ytnotes-gist-actions { display: flex; gap: 8px; margin-top: 12px; }
      .ytnotes-gist-textbtn {
        display: block;
        margin-top: 10px;
        padding: 0;
        background: none;
        border: none;
        color: #909090;
        font: 400 11px/1.4 "Roboto", Arial, sans-serif;
        text-align: left;
        cursor: pointer;
      }
      .ytnotes-gist-textbtn:hover { color: #ff4e45; text-decoration: underline; }
      .ytnotes-gist-rows { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
      .ytnotes-gist-row { display: flex; justify-content: space-between; gap: 10px; }
      .ytnotes-gist-k { color: #909090; }
      .ytnotes-gist-v { font-weight: 500; }
      .ytnotes-gist-status {
        margin-top: 10px;
        font-size: 11px;
        color: #cfcfcf;
        line-height: 1.4;
        word-break: break-word;
      }
      .ytnotes-gist-status:empty { margin-top: 0; }
      .ytnotes-gist-ok { color: #2ba640; }
      .ytnotes-gist-bad { color: #ff4e45; }

      .ytnotes-thumbnail-verdict {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 4px 6px;
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        font: 700 10px/1.3 "Roboto", Arial, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ytnotes-reflect-backdrop {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(2px);
      }
      .ytnotes-reflect-card {
        position: absolute;
        width: 330px;
        max-width: calc(100vw - 32px);
        box-sizing: border-box;
        padding: 18px;
        border-radius: 14px;
        background: #212121;
        color: #f1f1f1;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.6);
        font: 400 13px/1.45 "Roboto", Arial, sans-serif;
      }
      .ytnotes-reflect-head { color: #909090; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
      .ytnotes-reflect-title {
        margin-top: 6px;
        font-size: 13px;
        color: #cfcfcf;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
      .ytnotes-reflect-q { margin: 14px 0 10px; font-size: 16px; font-weight: 700; }
      .ytnotes-reflect-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .ytnotes-reflect-chip {
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.06);
        color: #f1f1f1;
        font: 600 13px/1 "Roboto", Arial, sans-serif;
        cursor: pointer;
        transition: opacity 0.2s ease, background 0.15s ease;
      }
      .ytnotes-reflect-chip:hover:not(:disabled) { background: #f1f1f1; color: #0f0f0f; }
      .ytnotes-reflect-chip:disabled { opacity: 0.28; cursor: default; }
      .ytnotes-reflect-foot {
        margin-top: 14px;
        min-height: 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #909090;
        font-size: 12px;
      }
      .ytnotes-reflect-skip {
        margin-left: auto;
        background: none;
        border: none;
        color: #707070;
        font: 400 11px/1 "Roboto", Arial, sans-serif;
        cursor: pointer;
        text-decoration: underline;
      }
      .ytnotes-reflect-skip:hover { color: #cfcfcf; }

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
    const bootVideo = getCurrentPageVideo();
    if (bootVideo) {
      bootVideoSnapshot = { id: bootVideo.id, watched: Store.isWatched(bootVideo.id) };
    }

    injectStyles();
    observeFeeds();
    startEnforcer();
    GistSync.start();
    HistorySync.start();
    Reflection.start();
    GistUI.mount();
    exposeApi();

    if (location.pathname === '/watch') {
      retryUntil(attachWatchPage);
    } else if (location.pathname.startsWith('/shorts/')) {
      retryUntil(attachShortPage);
    }
  }

  /* ============================================================
   * MANUAL CONTROLS (console + Tampermonkey menu)
   * ============================================================ */

  function exposeApi() {
    const api = {
      syncNow: () => HistorySync.syncNow(),
      fullResync: () => HistorySync.fullResync(),
      stats: () => {
        const s = Store.stats();
        const meta = HistorySync.meta();
        const info = {
          watched: s.watched,
          notes: s.notes,
          fromHistorySync: s.fromHistory,
          storedEntries: s.total,
          lastSync: meta.lastSync ? new Date(meta.lastSync).toLocaleString() : 'never',
          accounts: meta.knownAuthUsers || [],
          lastError: meta.lastError || null
        };
        console.table(info);
        return info;
      },
      clearSynced: () => {
        const n = Store.clearSynced();
        toast('Cleared ' + n + ' synced watched marks', 3000);
        return n;
      },
      gist: {
        open: () => GistUI.toggle(true),
        connect: (token) => GistSync.connect(token),
        sync: () => GistSync.syncNow(),
        overwrite: () => GistSync.overwriteFromLocal(),
        disconnect: () => GistSync.disconnect(),
        status: () => {
          const cfg = GistSync.config();
          const counts = Store.watchedIds();
          return {
            connected: GistSync.isConfigured(),
            account: cfg.login || null,
            gistId: cfg.id || null,
            videos: counts.videos.length,
            shorts: counts.shorts.length,
            lastSync: cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'never',
            lastError: GistSync.lastError() || null
          };
        }
      },
      reflection: {
        summary: () => {
          const s = Reflection.summary();
          console.table(s.what);
          console.table(s.why);
          return s;
        },
        askNow: () => Reflection.askNow(),
        pending: () => Reflection.queued(),
        debug: () => {
          const d = Reflection.debug();
          console.log('[YT Notes] reflection state', d);
          return d;
        }
      },
      config: { history: HISTORY_SYNC, gist: GIST_SYNC, reflection: REFLECTION }
    };

    try {
      const target = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      target.YTNotes = api;
    } catch (e) {
      window.YTNotes = api;
    }

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Sync YouTube history now', () => api.syncNow());
      GM_registerMenuCommand('Full history re-sync (deep)', () => api.fullResync());
      GM_registerMenuCommand('Watched/notes stats', () => api.stats());
      GM_registerMenuCommand('Clear synced watched marks', () => {
        if (confirm('Remove watched marks that came from history/gist sync? Your notes stay.')) api.clearSynced();
      });
      GM_registerMenuCommand('Gist sync settings…', () => api.gist.open());
      GM_registerMenuCommand('Sync watched list to Gist now', () => api.gist.sync());
      GM_registerMenuCommand('Why did I watch that? (log now)', () => api.reflection.askNow());
      GM_registerMenuCommand('Reflection summary', () => api.reflection.summary());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
