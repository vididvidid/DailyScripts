/*
 * File: whatsappRotate.js
 * Author: vididvidid
 * Created: 2026-10-07
 *
 * versions:
 *
 * 0.1.2          blur fix made sturdier: hides more kinds of backdrop and
 *                lays a plain panel under the rotated photo; green dot is
 *                now positioned beside the title instead of inside it (it
 *                was being clipped); logs "[wa-rotate] v… loaded" and what
 *                it hid on each rotate, to the browser console
 *
 * 0.1.1          the blurred preview WhatsApp keeps behind a photo no longer
 *                pokes out around a rotated one; no floating buttons on the
 *                chat screen any more — buttons only in the viewer toolbar,
 *                and a green dot beside "WhatsApp" shows the script is on
 *
 * 0.1.0          rotate left / right buttons in the WhatsApp Web media
 *                viewer toolbar (and R / Shift+R shortcuts); a sideways
 *                photo is scaled up to fill the viewer once turned
 */

/**
 * ============================================================================
 * HOW IT FINDS THINGS
 * ============================================================================
 * WhatsApp's class names are hashed and change every release, and its
 * aria-labels follow the UI language, so neither is used. Instead:
 *
 *   viewer image   the largest visible <img src="blob:…"> (or <video>) that
 *                  is big (≥40% of the viewport on one side) and sits near the
 *                  horizontal centre of the window. Chat bubbles are small
 *                  and live in the right-hand pane, so they never qualify.
 *
 *   toolbar        the row of icon buttons across the top-right of the
 *                  viewer (zoom, reply, star, …, close). Found by looking for
 *                  ≥5 buttons sharing one parent in the top 100px of the
 *                  right half of the window. Our two buttons go in front of
 *                  the first of them. No such row → not the viewer → nothing
 *                  is shown (the buttons never appear on the chat screen).
 *
 *   backdrop       WhatsApp keeps a blurred preview copy of the photo right
 *                  behind it. While a photo is rotated, anything around it
 *                  covering the same footprint is hidden, so the turned photo
 *                  sits on the viewer's plain background.
 *
 *   status dot     a small green dot beside the "WhatsApp" title in the chat
 *                  list shows the script is loaded.
 *
 * Rotation uses the individual CSS `rotate` / `scale` properties rather than
 * `transform`, so it composes with whatever transform WhatsApp's own zoom
 * puts on the image instead of overwriting it.
 *
 * Rotation is remembered per image (by blob URL) for the session, so paging
 * back to a photo you already turned keeps it turned.
 */

// ==UserScript==
// @name         WhatsApp Web – Rotate Image
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.1.2
// @description  Adds rotate left / right buttons to the WhatsApp Web image viewer
// @author       vididvidid
// @match        https://web.whatsapp.com/*
// @grant        GM_addStyle
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── 1. Config ─────────────────────────────────────────────────────────────
  const MIN_SIDE_FRACTION = 0.4;   // viewer media is at least this much of the viewport
  const CENTER_TOLERANCE  = 0.15;  // …and its centre within 15% of the window centre
  const TOOLBAR_MAX_TOP   = 100;   // px from the top the toolbar buttons sit within
  const TOOLBAR_MIN_BTNS  = 5;
  const SIDE_MARGIN       = 240;   // room kept for the ‹ › arrows when scaling to fit
  const CHECK_THROTTLE_MS = 150;
  const ID                = 'wa-rotate';

  const VERSION = '0.1.2';
  const log = (...a) => console.log('[wa-rotate]', ...a);

  const rotations = new Map();     // media src → degrees (0/90/180/270)

  // ── 2. Styles ─────────────────────────────────────────────────────────────
  const css = `
    .${ID}-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; margin: 0 6px; padding: 0;
      border: 0; border-radius: 50%; background: transparent;
      color: inherit; cursor: pointer; flex: none;
    }
    .${ID}-btn:hover { background: rgba(128,128,128,.18); }
    .${ID}-btn svg  { width: 24px; height: 24px; fill: currentColor; pointer-events: none; }
    #${ID}-dot {
      position: fixed; z-index: 2147483647; pointer-events: auto;
      width: 8px; height: 8px; border-radius: 50%;
      background: #25d366; box-shadow: 0 0 6px 1px rgba(37,211,102,.8);
    }
    .${ID}-anim { transition: rotate .2s ease, scale .2s ease; }
  `;
  if (typeof GM_addStyle === 'function') GM_addStyle(css);
  else { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  // ── 3. Icons (built with DOM APIs — WhatsApp enforces Trusted Types) ─────
  const ICON_PATHS = {
    left:  'M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z',
    right: 'M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z',
  };

  function makeButton(dir) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${ID}-btn`;
    btn.dataset.waRotate = dir;
    btn.title = dir === 'left' ? 'Rotate left (Shift+R)' : 'Rotate right (R)';
    btn.setAttribute('aria-label', btn.title);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PATHS[dir]);
    svg.appendChild(path);
    btn.appendChild(svg);
    // Stop WhatsApp treating the click as "click outside the image → close".
    ['pointerdown', 'mousedown', 'mouseup'].forEach(t =>
      btn.addEventListener(t, e => e.stopPropagation()));
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      rotate(dir === 'left' ? -90 : 90);
    });
    return btn;
  }

  // ── 4. Finding the viewer ────────────────────────────────────────────────
  function isVisible(r) {
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function findViewerMedia() {
    let best = null, bestArea = 0;
    const candidates = document.querySelectorAll('img[src^="blob:"], video');
    for (const el of candidates) {
      if (el.closest('[data-wa-rotate-ui]')) continue;
      // Layout size, so our own rotate/scale doesn't change the verdict.
      const w = el.offsetWidth, h = el.offsetHeight;
      const r = el.getBoundingClientRect();
      if (!isVisible(r)) continue;
      if (h < innerHeight * MIN_SIDE_FRACTION && w < innerWidth * MIN_SIDE_FRACTION) continue;
      const cx = r.left + r.width / 2;
      if (Math.abs(cx - innerWidth / 2) > innerWidth * CENTER_TOLERANCE) continue;
      if (w * h > bestArea) { best = el; bestArea = w * h; }
    }
    return best;
  }

  // The top-right icon row: a parent with ≥ TOOLBAR_MIN_BTNS children that
  // each are (or contain) a button in the top band, right half of the window.
  function findToolbar() {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(b => {
      if (b.closest('[data-wa-rotate-ui]')) return false;
      const r = b.getBoundingClientRect();
      return isVisible(r) && r.top < TOOLBAR_MAX_TOP && r.left > innerWidth / 2
        && r.width < 80 && r.height < 80;
    });
    const counts = new Map();
    for (const b of buttons) {
      // Climb until we reach a node with siblings — that node is the "item".
      let item = b;
      while (item.parentElement && item.parentElement.children.length === 1) item = item.parentElement;
      const row = item.parentElement;
      if (!row) continue;
      counts.set(row, (counts.get(row) || 0) + 1);
    }
    let row = null, max = 0;
    for (const [el, n] of counts) if (n > max) { row = el; max = n; }
    return max >= TOOLBAR_MIN_BTNS ? row : null;
  }

  // ── 5. Rotation ───────────────────────────────────────────────────────────
  let current = null;              // the media element being shown

  function keyOf(el) { return el.currentSrc || el.src || ''; }

  function apply(el, animate) {
    const deg = rotations.get(keyOf(el)) || 0;
    el.classList.toggle(`${ID}-anim`, !!animate);
    if (deg === 0) {
      el.style.removeProperty('rotate');
      el.style.removeProperty('scale');
      restoreBackdrop();
      return;
    }
    hideBackdrop(el);
    let scale = 1;
    if (deg % 180 !== 0) {
      // Fit the turned image into the space WhatsApp gave it, growing a
      // portrait photo that is lying on its side up to the viewer width.
      const w = el.offsetWidth, h = el.offsetHeight;
      const availW = Math.max(w, innerWidth - SIDE_MARGIN);
      const availH = h;          // WhatsApp already fitted it to the vertical space
      scale = Math.min(availW / h, availH / w);
    }
    el.style.setProperty('rotate', `${deg}deg`);
    el.style.setProperty('scale', String(Math.round(scale * 1000) / 1000));
  }

  // WhatsApp layers a blurred copy of the photo (the low-res preview) right
  // behind the sharp one. Unrotated, the sharp photo covers it exactly; turned,
  // its edges stick out. Two layers of defence while a photo is rotated:
  //   1. hide anything nearby that occupies the photo's original footprint
  //      (an <img>/<canvas>, a background-image, or anything blurred);
  //   2. slip a plain "cover" panel, painted the viewer's own background
  //      colour, over that footprint just underneath the photo — so even a
  //      backdrop step 1 didn't recognise ends up out of sight.
  // Everything is given back on rotate-to-0, on a new photo, or on close.
  const hidden = [];               // [el, prop, oldValue]
  let cover = null;

  function restoreBackdrop() {
    for (const [node, prop, old] of hidden.splice(0)) {
      if (old) node.style.setProperty(prop, old); else node.style.removeProperty(prop);
    }
    if (cover) cover.remove();
    cover = null;
  }

  function viewerBackground(el) {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const c = getComputedStyle(a).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor || '#fff';
  }

  function hideBackdrop(el) {
    restoreBackdrop();
    // The photo's footprint without our rotate/scale applied.
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const w = el.offsetWidth, h = el.offsetHeight;
    const box = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
    const covers = n => {
      const b = n.getBoundingClientRect();
      const ix = Math.min(b.right, box.right) - Math.max(b.left, box.left);
      const iy = Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top);
      return ix > 0 && iy > 0 && ix * iy >= 0.6 * w * h;
    };
    const hide = (node, prop, value) => {
      hidden.push([node, prop, node.style.getPropertyValue(prop)]);
      node.style.setProperty(prop, value, 'important');
    };

    // 1. Search the containers around the photo, not the whole page.
    let root = el;
    for (let i = 0; i < 8 && root.parentElement && root.parentElement !== document.body; i++) {
      root = root.parentElement;
    }
    const found = [];
    for (const n of root.querySelectorAll('*')) {
      if (n === el || n.contains(el) || el.contains(n)) continue;
      if (n.closest('[data-wa-rotate-ui], button, [role="button"]')) continue;
      if (n instanceof SVGElement && !(n instanceof SVGSVGElement)) continue;
      const cs = getComputedStyle(n);
      const isMedia = /^(IMG|CANVAS|VIDEO|PICTURE|svg)$/i.test(n.tagName);
      const hasBg = cs.backgroundImage !== 'none';
      const blurred = (cs.filter || '').includes('blur') || (cs.backdropFilter || '').includes('blur');
      if (!isMedia && !hasBg && !blurred) continue;
      if (!covers(n)) continue;
      hide(n, 'visibility', 'hidden');
      found.push(n);
    }
    // A blurred preview set as a background on one of the photo's own
    // wrappers can't be hidden without hiding the photo — strip it instead.
    for (let a = el.parentElement, i = 0; a && i < 8; a = a.parentElement, i++) {
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== 'none' && covers(a)) { hide(a, 'background-image', 'none'); found.push(a); }
      if ((cs.filter || '').includes('blur')) { hide(a, 'filter', 'none'); found.push(a); }
    }

    // 2. The cover panel: an earlier sibling of the photo, same box, plain
    //    colour. The photo is made position:relative (if it wasn't
    //    positioned) so it still paints above the panel.
    const ecs = getComputedStyle(el);
    if (ecs.position === 'static') hide(el, 'position', 'relative');
    cover = document.createElement('div');
    cover.dataset.waRotateUi = '';
    Object.assign(cover.style, {
      position: 'absolute', pointerEvents: 'none', margin: '0',
      left: el.offsetLeft + 'px', top: el.offsetTop + 'px',
      width: w + 'px', height: h + 'px',
      background: viewerBackground(el),
      zIndex: ecs.zIndex === 'auto' ? 'auto' : ecs.zIndex,
    });
    el.parentElement.insertBefore(cover, el);

    log('rotated', rotations.get(keyOf(el)), '° — hid', found.length, 'backdrop element(s):', found,
        '| photo:', el, '| cover colour:', cover.style.background);
  }

  function rotate(delta) {
    const el = current && current.isConnected ? current : null;
    if (!el) return;
    current = el;
    const key = keyOf(el);
    const deg = (((rotations.get(key) || 0) + delta) % 360 + 360) % 360;
    rotations.set(key, deg);
    apply(el, true);
  }

  // ── 6. Mounting the buttons ──────────────────────────────────────────────
  let group = null;                // our <span> holding both buttons

  function buildGroup() {
    const g = document.createElement('span');
    g.dataset.waRotateUi = '';
    g.style.display = 'inline-flex';
    g.style.alignItems = 'center';
    g.appendChild(makeButton('left'));
    g.appendChild(makeButton('right'));
    return g;
  }

  function unmount() {
    if (group) group.remove();
    group = null;
  }

  // Returns false when there is no viewer toolbar — then this isn't the
  // media viewer (a big image in the chat, say) and nothing is shown.
  function mount() {
    const toolbar = findToolbar();
    if (!toolbar) { unmount(); return false; }
    if (group && group.parentElement === toolbar) return true;
    unmount();
    group = buildGroup();
    toolbar.insertBefore(group, toolbar.firstElementChild);
    return true;
  }

  // Green dot beside the "WhatsApp" title in the chat list, so you can see
  // the script is loaded without it putting anything on the chat screen.
  // It is a fixed-position element placed from the title's on-screen box
  // (inserting into the title itself got clipped by its overflow:hidden).
  let dot = null, title = null;

  function findTitle() {
    const ok = t => {
      const r = t.getBoundingClientRect();
      return isVisible(r) && r.top < 200 && r.left < innerWidth / 2 && r.width < 400;
    };
    const hit = document.evaluate(
      "//*[normalize-space(text())='WhatsApp'] | //*[@aria-label='WhatsApp' or @title='WhatsApp']"
        + " | //*[local-name()='title' and normalize-space(text())='WhatsApp']/..",
      document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < hit.snapshotLength; i++) {
      const t = hit.snapshotItem(i);
      if (t.closest && t.closest('[data-wa-rotate-ui]')) continue;
      if (ok(t)) return t;
    }
    return null;
  }

  function ensureDot() {
    if (!dot) {
      dot = document.createElement('span');
      dot.id = `${ID}-dot`;
      dot.dataset.waRotateUi = '';
      dot.title = 'Rotate Image script is running';
    }
    if (!dot.isConnected) document.body.appendChild(dot);
    if (!title || !title.isConnected) title = findTitle();
    const r = title && title.getBoundingClientRect();
    // Hidden while the title isn't on screen (viewer open, chat list closed).
    if (!r || !isVisible(r) || group) { dot.style.display = 'none'; return; }
    dot.style.display = 'block';
    dot.style.left = Math.round(r.right + 8) + 'px';
    dot.style.top  = Math.round(r.top + r.height / 2 - 4) + 'px';
  }

  // ── 7. Watching the page ─────────────────────────────────────────────────
  let lastKey = null;

  function check() {
    ensureDot();
    const el = findViewerMedia();
    if (!el || !mount()) {
      current = null;
      lastKey = null;
      restoreBackdrop();
      unmount();
      return;
    }
    const key = keyOf(el);
    if (el !== current || key !== lastKey) {
      restoreBackdrop();
      current = el;
      lastKey = key;
      apply(el, false);    // restore (or clear) this photo's rotation
    }
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; check(); }, CHECK_THROTTLE_MS);
  }

  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
  });
  addEventListener('resize', () => { if (current) apply(current, false); schedule(); });

  // R = rotate right, Shift+R = rotate left — only while the viewer is open
  // and focus is not in a text field.
  addEventListener('keydown', e => {
    if (!group || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'r' && e.key !== 'R') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    e.stopPropagation();
    rotate(e.shiftKey ? -90 : 90);
  }, true);

  log('v' + VERSION, 'loaded');
  schedule();
})();
