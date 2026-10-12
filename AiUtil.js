/*
 * File: AiUtil.js
 * Author: vididvidid , mic mejia
 * Created: 2026-08-07 18:58:38
 *
 * versions:
 *
 *  0.1.0        json to toon
 *               text minifier
 *               snapcompact
 *               json download
 *               md download
 *               URL way to detect page change
 *               Auto scroll for lazy loading
 *
 *  0.2.0        Prompt Library (save / edit / delete prompts)
 *               GitHub Gist sync for the prompt library
 *               Quick Dock — floating prompt strip over the site's
 *               composer/input box; click a prompt to insert it
 *               Chat-source picker (selected / entire chat / custom) for the
 *               Text Minifier and JSON->TOON tools
 *               Panel now shows on empty/new chats instead of hiding
 *
 *  0.3.0        Each tool now carries its own turn checklist — "pick turns"
 *               used to read the export outline, which is not in the DOM
 *               unless that section is open, so it was always empty
 *               Floating Dock position stored as a viewport fraction, so it
 *               stops wandering when the window is resized
 *               Named the two pieces: Floating Dock and Quick Dock
 *               bookmarklet.html — packs the script into a javascript: URL
 *               for mobile browsers with no userscript manager
 *
 *  0.4.0        Gist file renamed to prompts.gist — the old
 *               aiutil-prompts.json is still read and removed on next sync
 *               "View on GitHub" button opens the gist in a new tab
 *               Net also accepts GM.xmlHttpRequest, and a blocked request now
 *               says whether the stub lacks the grant or it is a bookmarklet
 *
 *  0.4.1        Bug fixes — Quick Dock:
 *               It glued itself to the bare text field, so attaching a file
 *               (which grows the card above the text, not the field) left it
 *               sitting mid-card over the attachment; it now anchors to the
 *               whole composer card
 *               It drew over the site's own menus ("+" tools on Gemini); it
 *               now hides while an open menu/listbox/dialog overlaps it
 *               Known open: on Grok it still draws over the "+" and model
 *               menus (Radix, role="menu"). The overlap check hides the bar
 *               on that exact markup in headless Chromium, so the live page
 *               differs somehow — not yet diagnosed
 *               It sat on top of buttons the site floats just above the card
 *               (Gemini's "Answer now" while generating), which showed
 *               through the translucent bar; it now shrinks to its icons in
 *               the right corner (full bar on hover), or hides if even the
 *               corner is taken
 *
 *  0.5.0        SVG icons everywhere instead of text labels (PL, MD, …) and
 *               glyph characters
 *               Quick Dock tools that rewrite the input box in place:
 *               JSON->TOON, Text Minifier, Snapcompact (text becomes an
 *               attached image) and save-as-prompt
 *               Context meter: a green / yellow / red light on the Quick Dock
 *               for when to move to a new chat, with the breakdown, budget
 *               and handoff prompt in the Floating Dock
 *               The meter reads the whole conversation from the site's own
 *               backend (old chats included, current branch only) and counts
 *               it with the real tokenizer: o200k_base locally for ChatGPT /
 *               Copilot, the providers' count APIs for Claude, Gemini and
 *               Grok when a key is set; claude.ai plan usage shown too
 *               New chat with context (Quick Dock arrow + Floating Dock
 *               section): opens a new chat with the whole conversation in
 *               the input box as a transcript, TOON, minified text or
 *               Snapcompact images
 *               Tooltips redone as cards (title, description, keys), with
 *               no version number in them
 *               "Experimental" tags on the context meter and the handoff
 *               Inter font for both docks, loaded as bytes so site CSPs
 *               cannot block it
 *               Snapcompact pages open full size in a viewer (actual pixels
 *               or fit, arrow keys between pages, click or Esc to close)
 *               Source dropdowns show a chevron
 *
 *  0.6.0        Floating Dock rail is two columns, tools paired by purpose;
 *               the single-column fisheye hover became a per-button one
 *               Skills Library (ALT+K): save skills (name, "use when",
 *               instructions) or import SKILL.md files; a click brings one
 *               into the chat as a <skill> block in the input box, or as an
 *               attached .md file. Skills sync through the same gist and
 *               show as sparkle chips on the Quick Dock
 */

// ==UserScript==
// @name         ChatGPT / Claude / Copilot / Gemini / Grok AI Chat Exporter by RevivalStack
// @namespace    [old]https://github.com/revivalstack/chatgpt-exporter
// @version      3.10.0
// @description  Export your ChatGPT, Claude, Copilot, Gemini or Grok chat into a properly and elegantly formatted Markdown or JSON. Includes a Gist-synced Prompt Library and Skills Library with a Quick Dock over the site's input box, Text Minifier, JSON→TOON converter and Snapcompact — in one draggable, two-column icon-dock panel.
// @author       vididvidid, Mic Mejia (Refactored UI)
// @license      MIT License
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://www.copilot.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      cdn.jsdelivr.net
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.x.ai
// @noframes
// ==/UserScript==

/**
 * ============================================================================
 * ARCHITECTURE OVERVIEW
 * ============================================================================
 * This file is organized in layers, each with a single responsibility.
 * Later layers may depend on earlier ones, never the other way around.
 *
 *   1. Config        - constants, GM storage keys, defaults (no logic)
 *   2. Theme          - design tokens + stylesheet injection (no logic)
 *   3. Utils          - small, pure, stateless helper functions
 *   4. Net            - GM_xmlhttpRequest/fetch wrapper (CSP-proof HTTP)
 *   5. Lib            - vendored third-party-style libs (Turndown, TOON)
 *   6. Snapcompact    - "chat -> compact PNG" rendering engine
 *   7. Platforms      - one adapter per AI site (THE extension point).
 *                       To support a new site: add one object here, done.
 *   8. PromptStore    - prompt library CRUD + GitHub Gist sync
 *   9. Composer       - finds the site's input box and types text into it
 *  10. ChatExporter   - core domain logic: extract -> format -> download.
 *                       Delegates all site-specific work to Platforms.
 *  11. UI             - panel shell, drag handling, sections (the "app"),
 *                       plus QuickDock — the strip over the composer.
 *  12. Bootstrap      - wires everything together and starts the script.
 *
 * To add a new export format:      add a formatter in ChatExporter.formatters
 * To add a new AI site:            add an entry to Platforms.registry
 *                                  (include composerSelectors for the Quick Dock)
 * To add a new panel feature:      add a "section" module under UI.sections
 * To change colors/spacing:        edit Theme.tokens only
 * ============================================================================
 */
(function () {
  "use strict";

  /* ==========================================================================
   * 1. CONFIG — constants & persisted-setting keys. No logic lives here.
   * ========================================================================== */
  const Config = {
    VERSION: "3.10.0",
    DOM_READY_TIMEOUT_MS: 1000,
    AUTOSCROLL_INITIAL_DELAY_MS: 2000,

    // How often the QuickDock re-checks that it is still glued to the composer.
    QUICKDOCK_POLL_MS: 600,
    // Keep-off-the-edges margin for the Floating Dock, in px. The drag bounds,
    // the free-space maths and the restore path all share it, so a saved
    // position round-trips to exactly where it was left.
    PANEL_EDGE_MARGIN: 4,
    // Distance from the rail's edge to the content column beside it: the
    // two-column rail's width plus a small gap.
    PANEL_CONTENT_OFFSET: 100,
    QUICKDOCK_MAX_CHIPS: 12,

    DEFAULT_CHAT_TITLE: "chat",
    DEFAULT_OUTPUT_FILE_FORMAT: "{platform}_{title}_{timestampLocal}",
    DEFAULT_CHAT_TITLE_PREFIX: "",

    DOM: {
      PANEL_ID: "ai-exporter-panel",
      PANEL_BODY_ID: "ai-exporter-panel-body",
      OUTLINE_LIST_ID: "ai-exporter-outline-list",
      QUICKDOCK_ID: "ai-exporter-quick-dock",
    },

    // GitHub Gist is the sync backend for the prompt library. A single secret
    // gist holds one JSON file; the token needs only the "gist" scope.
    GIST: {
      API: "https://api.github.com",
      FILENAME: "prompts.gist",
      // Earlier name. Still read if the new file is absent, and deleted on the
      // next push, so gists made before the rename migrate themselves.
      LEGACY_FILENAME: "aiutil-prompts.json",
      WEB: "https://gist.github.com",
      DESCRIPTION: "AiUtil prompt library",
      SCHEMA_VERSION: 1,
      TIMEOUT_MS: 20000,
    },

    // Tampermonkey GM_* storage keys, centralized so nothing is a magic string.
    GM_KEYS: {
      OUTPUT_FILE_FORMAT: "aiChatExporter_fileFormat",
      PANEL_POS_X: "aiChatExporter_panelPosX", // legacy px, migrated on load
      PANEL_POS_Y: "aiChatExporter_panelPosY", // legacy px, migrated on load
      PANEL_POS_RATIO_X: "aiUtil_panelPosRatioX",
      PANEL_POS_RATIO_Y: "aiUtil_panelPosRatioY",
      PANEL_GLOBAL_COLLAPSED: "aiChatExporter_globalCollapsed",
      PANEL_ACTIVE_SECTION: "aiChatExporter_panelActiveSection",
      CHAT_TITLE_PREFIX: "aiChatExporter_chatTitlePrefix",
      AUTO_SCROLL_ENABLED: "gm_auto_scroll_enabled",
      PROMPTS: "aiUtil_prompts", // prompts and skills, told apart by .kind
      SKILL_IMPORT_MODE: "aiUtil_skillImportMode", // "text" | "file"
      GIST_TOKEN: "aiUtil_gistToken",
      GIST_ID: "aiUtil_gistId",
      GIST_LAST_SYNC: "aiUtil_gistLastSync",
      QUICKDOCK_ENABLED: "aiUtil_quickDockEnabled",
      METER_BUDGETS: "aiUtil_meterBudgets", // { platformId: tokens }
      METER_WARN_PCT: "aiUtil_meterWarnPct",
      METER_CRIT_PCT: "aiUtil_meterCritPct",
      METER_TOKENIZER: "aiUtil_meterTokenizer", // { provider: { key, model } }
      O200K_CACHE: "aiUtil_o200kRanks_v1",
      FONT_CACHE: "aiUtil_fontInter_v1",
      HANDOFF_SETTINGS: "aiUtil_handoffSettings",
      HANDOFF_PENDING: "aiUtil_handoffPending",
    },

    // Context meter. Budgets are a guess at where a chat starts to degrade,
    // deliberately below each site's hard context window; editable per site
    // from the meter panel.
    METER: {
      DEFAULT_BUDGETS: {
        chatgpt: 100000,
        claude: 150000,
        copilot: 60000,
        gemini: 400000,
        grok: 100000,
      },
      FALLBACK_BUDGET: 100000,
      WARN_PCT: 50,
      CRIT_PCT: 80,
      // Role/format tokens each turn costs on top of its text.
      TURN_OVERHEAD: 4,
      RECOUNT_DEBOUNCE_MS: 3000,
      // The history is refetched at most this often while a chat is active.
      HISTORY_MIN_INTERVAL_MS: 15000,
      USAGE_REFRESH_MS: 60000,
      // js-tiktoken's copy of OpenAI's o200k_base ranks (2.3 MB, cached).
      O200K_URL: "https://cdn.jsdelivr.net/npm/js-tiktoken@1.0.21/dist/ranks/o200k_base.js",
      HANDOFF_PROMPT:
        "Summarize this conversation so I can continue it in a new chat. " +
        "Include the goal, key decisions and why they were made, the current " +
        "state of the work (code, files, versions), open questions, and the " +
        "exact next steps. Be dense and skip pleasantries. Output only the summary.",
    },

    MARKDOWN: {
      TOC_PLACEHOLDER_LINK: "#table-of-contents",
      get BACK_TO_TOP_LINK() {
        return `___\n###### [top](${Config.MARKDOWN.TOC_PLACEHOLDER_LINK})\n`;
      },
    },

    // Inter (variable, Latin subset) for the docks. Loaded as bytes, so the
    // sites' font-src CSP does not apply; the system font is the fallback.
    FONT: {
      FAMILY: "AiUtil Inter",
      URL: "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.2.8/files/inter-latin-wght-normal.woff2",
    },

    // "New chat with context": carries the conversation into a fresh chat.
    HANDOFF: {
      // A pending handoff older than this is ignored (the new tab never came).
      TTL_MS: 3 * 60 * 1000,
      // How long the new chat's page gets to show its input box.
      COMPOSER_WAIT_MS: 30000,
      DEFAULTS: {
        format: "toon", // transcript | toon | minify | snapcompact
        attachments: true,
        tools: false,
        newTab: true,
        preamble:
          "Below is our previous conversation, carried over as context. " +
          "Read it, then continue from where it left off. Do not summarize " +
          "it back to me; just confirm you have it and wait for my next message.",
      },
    },

    PARAGRAPH_FILTER_PARENT_NODES: ["TH", "TR"],
  };

  /**
   * Small typed wrapper around GM_getValue/GM_setValue so callers never touch
   * GM_* directly.
   */
  const Store = {
    get: (key, fallback) => GM_getValue(key, fallback),
    set: (key, value) => GM_setValue(key, value),
  };

  /* ==========================================================================
   * 2. THEME — design tokens + stylesheet. Pure presentation, no behavior.
   * ========================================================================== */
  const Theme = {
    fontStack: `"${Config.FONT.FAMILY}", "Inter", "Inter Variable", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,
    monoStack: `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace`,

    /**
     * Registers Inter for the docks. The file is fetched once as bytes and
     * kept in storage; a FontFace built from bytes is not a network load, so
     * the sites' font-src CSP cannot block it. Any failure leaves the
     * system-font fallback in place.
     */
    async loadFont() {
      try {
        if (typeof FontFace !== "function" || !document.fonts) return;
        let b64 = Store.get(Config.GM_KEYS.FONT_CACHE, "");
        if (!b64) {
          const res = await Net.request({ url: Config.FONT.URL, responseType: "arraybuffer" });
          if (res.status !== 200 || !res.body) return;
          const bytes = new Uint8Array(res.body);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 8192)
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          b64 = btoa(bin);
          Store.set(Config.GM_KEYS.FONT_CACHE, b64);
        }
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const face = new FontFace(Config.FONT.FAMILY, buf.buffer, { weight: "100 900", style: "normal" });
        await face.load();
        document.fonts.add(face);
      } catch (e) {
        /* offline, blocked @connect or no FontFace — keep the system font */
      }
    },

    // White & black design tokens — the single source of truth for all colors.
    tokens: {
      panelGradient: "#ffffff",
      railGradient: "#ffffff",
      headerGradient: "#f5f5f5",
      buttonGradient: "#000000",
      buttonGradientHover: "#333333",
      buttonSecondaryGradient: "#ffffff",
      railIconActive: "#000000",
      textLight: "#000000",
      textMuted: "#666666",
      borderSoft: "#000000",
      inputBg: "#ffffff",
      inputText: "#000000",
      shadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      // Context meter levels.
      meterOk: "#16a34a",
      meterWarn: "#eab308",
      meterCrit: "#dc2626",
    },

    /** Injects the panel-wide stylesheet exactly once. */
    injectStyles() {
      if (document.getElementById("ai-exporter-styles")) return;
      const t = Theme.tokens;
      const style = document.createElement("style");
      style.id = "ai-exporter-styles";
      style.textContent = `
                #${Config.DOM.PANEL_ID} {
                    position: fixed;
                    z-index: 2147483000;
                    display: flex;
                    background: transparent;
                    color: ${t.textLight};
                    font-family: ${Theme.fontStack};
                    font-size: 12.5px;
                    line-height: 1.45;
                    font-weight: 400;
                    letter-spacing: -0.006em;
                    font-feature-settings: "cv11", "ss01", "tnum";
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    text-rendering: optimizeLegibility;
                    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    transform-origin: top right;
                    transform: scale(0.65);
                }
                #${Config.DOM.PANEL_ID}:hover, #${Config.DOM.PANEL_ID}:has(#ai-exporter-content.open) {
                    transform: scale(1);
                }
                #${Config.DOM.PANEL_ID}.on-left {
                    transform-origin: top left;
                }
                #${Config.DOM.PANEL_ID} * { box-sizing: border-box; font-family: inherit; letter-spacing: inherit; }

                /* ---------- Icon rail (Fixed dimensions, anchors panel) ---------- */
                #ai-exporter-rail {
                    width: 92px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0; /* Remove gap to ensure contiguous hit areas */
                    padding: 8px;
                    background: ${t.railGradient};
                    border-radius: 14px;
                    box-shadow: ${t.shadow};
                    border: none;
                    position: relative;
                    transition: border-radius 0.2s, padding 0.2s, width 0.2s;
                }
                #ai-exporter-rail-drag {
                    width: 100%;
                    text-align: center;
                    letter-spacing: 2px;
                    opacity: 0.8;
                    font-size: 13px;
                    color: ${t.textMuted};
                    line-height: 1;
                    cursor: grab;
                    user-select: none;
                    touch-action: none;
                    padding: 2px 0 4px 0;
                    display: flex;
                    justify-content: center;
                }
                #ai-exporter-rail-drag:active { cursor: grabbing; }

                .ai-exporter-rail-spacer { flex: 1; min-height: 4px; }

                /* Two columns of tool buttons; the grip and the eye span both. */
                #ai-exporter-rail-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 36px);
                    grid-auto-rows: 36px;
                    gap: 4px;
                    justify-content: center;
                }

                .ai-exporter-rail-btn {
                    width: 36px;
                    height: 36px;
                    margin: 0; /* Zero margin to ensure borders touch for stable tracking */
                    border-radius: 12px;
                    border: 3px solid transparent; /* Acts as visual gap but keeps hit area solid */
                    background-clip: padding-box;
                    background-color: rgba(0, 0, 0, 0.08); /* Default light black */
                    color: ${t.textLight}; /* Fix visibility */
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-weight: 800;
                    letter-spacing: 0.2px;
                    line-height: 1.1;
                    position: relative;
                    flex-shrink: 0;
                    transition: all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
                }
                
                /* Hover: the cell stays put (a grid has no single "next" neighbour
                   to fisheye into), the button darkens and its icon grows. */
                .ai-exporter-rail-btn:hover {
                    z-index: 10;
                    background-color: rgba(0, 0, 0, 0.85);
                    color: #ffffff;
                    border-width: 1px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                }
                .ai-exporter-rail-btn:hover .rail-icon-emoji { font-size: 18px; }
                .ai-exporter-rail-btn:hover .rail-icon-text { font-size: 10px; opacity: 1; color: #ffffff; }
                .ai-exporter-rail-btn:hover .rail-icon-svg { width: 20px; height: 20px; }

                .ai-exporter-rail-btn.active {
                    background-color: #000000;
                    color: #ffffff;
                    border-color: transparent;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                .ai-exporter-rail-btn .rail-icon-emoji { font-size: 14px; line-height: 1; transition: all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1); }
                .ai-exporter-rail-btn .rail-icon-text { font-size: 8.5px; opacity: 0.8; height: auto; margin-top: 1px; transition: all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1); }

                .ai-exporter-rail-btn.small-btn {
                    width: 30px; height: 30px; border-radius: 8px; margin: 0; border-width: 2px;
                }
                .ai-exporter-rail-btn.small-btn .rail-icon-emoji { font-size: 13px; margin: 0; }
                .ai-exporter-rail-btn .rail-icon-svg {
                    width: 16px; height: 16px; flex-shrink: 0; display: block;
                    transition: width 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1), height 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
                }
                .ai-exporter-rail-btn.small-btn .rail-icon-svg { width: 14px; height: 14px; }
                /* A toggle that is switched off (Quick Dock, auto-scroll). */
                .ai-exporter-rail-btn.off .rail-icon-svg { opacity: 0.35; }
                /* Status dot in a rail button's corner (context meter). */
                .ai-exporter-rail-badge {
                    position: absolute; top: 1px; right: 1px;
                    width: 8px; height: 8px; border-radius: 50%;
                    border: 1.5px solid #ffffff; background: ${t.meterOk};
                    pointer-events: none;
                }
                .ai-exporter-rail-badge[data-level="warn"] { background: ${t.meterWarn}; }
                .ai-exporter-rail-badge[data-level="crit"] { background: ${t.meterCrit}; }

                /* Tooltip card: title, optional tag, one-line description, keys. */
                .ai-exporter-tooltip {
                    position: absolute;
                    top: 50%;
                    right: calc(100% + 12px);
                    transform: translateY(-50%);
                    width: max-content;
                    max-width: 240px;
                    background: #111111;
                    color: #f5f5f5;
                    border-radius: 9px;
                    padding: 8px 10px;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.06);
                    display: none;
                    flex-direction: column;
                    gap: 3px;
                    z-index: 2147483001;
                    pointer-events: none;
                    text-align: left;
                    font-size: 12px;
                    font-weight: 400;
                    line-height: 1.4;
                    white-space: normal;
                }
                /* Arrow pointing at the rail. */
                .ai-exporter-tooltip::after {
                    content: ""; position: absolute; top: 50%; right: -4px;
                    width: 8px; height: 8px; background: #111111;
                    transform: translateY(-50%) rotate(45deg); border-radius: 1px;
                }
                #${Config.DOM.PANEL_ID}.on-left .ai-exporter-tooltip {
                    right: auto;
                    left: calc(100% + 12px);
                }
                #${Config.DOM.PANEL_ID}.on-left .ai-exporter-tooltip::after { right: auto; left: -4px; }
                /* Second-column tooltips clear the first column (36px + 4px gap);
                   docked on the left, the first column clears the second. */
                #ai-exporter-rail-grid > .ai-exporter-rail-btn:nth-child(even) .ai-exporter-tooltip {
                    right: calc(100% + 52px);
                }
                #${Config.DOM.PANEL_ID}.on-left #ai-exporter-rail-grid > .ai-exporter-rail-btn:nth-child(even) .ai-exporter-tooltip {
                    right: auto;
                }
                #${Config.DOM.PANEL_ID}.on-left #ai-exporter-rail-grid > .ai-exporter-rail-btn:nth-child(odd) .ai-exporter-tooltip {
                    left: calc(100% + 52px);
                }
                .ai-exporter-rail-btn:hover .ai-exporter-tooltip { display: flex; }
                .ai-exporter-tooltip .tt-head { display: flex; align-items: center; gap: 6px; }
                .ai-exporter-tooltip .tt-title { font-size: 12.5px; font-weight: 600; color: #ffffff; letter-spacing: -0.01em; }
                .ai-exporter-tooltip .tt-keys {
                    margin-left: auto; padding-left: 10px; display: flex; gap: 3px;
                }
                .ai-exporter-tooltip kbd {
                    font-family: ${Theme.monoStack}; font-size: 10px; font-weight: 500;
                    color: #d4d4d4; background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.14); border-bottom-width: 2px;
                    border-radius: 4px; padding: 0 4px; line-height: 15px;
                }
                .ai-exporter-tooltip .tt-desc { font-size: 11.5px; color: #a3a3a3; }
                .ai-exporter-tooltip .ai-exporter-tag { background: #fde68a; color: #713f12; border-color: transparent; }

                /* "Experimental" marker for features still being tuned. */
                .ai-exporter-tag {
                    display: inline-flex; align-items: center; gap: 3px;
                    font-size: 9.5px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase;
                    color: #92400e; background: #fef3c7; border: 1px solid #fcd34d;
                    border-radius: 999px; padding: 1px 6px 1px 5px; line-height: 14px;
                    white-space: nowrap; flex-shrink: 0;
                }
                .ai-exporter-tag svg { width: 10px; height: 10px; }

                /* ---------- Global Collapsed "Eye" State ---------- */
                #${Config.DOM.PANEL_ID}.global-collapsed #ai-exporter-rail {
                    width: 44px;
                    height: 44px;
                    padding: 0;
                    border-radius: 50%;
                    justify-content: center;
                    overflow: hidden;
                }
                #${Config.DOM.PANEL_ID}.global-collapsed .ai-exporter-rail-btn:not(#ai-exporter-rail-master-eye),
                #${Config.DOM.PANEL_ID}.global-collapsed #ai-exporter-rail-drag,
                #${Config.DOM.PANEL_ID}.global-collapsed #ai-exporter-rail-grid,
                #${Config.DOM.PANEL_ID}.global-collapsed .ai-exporter-rail-spacer {
                    display: none !important;
                }
                #${Config.DOM.PANEL_ID}.global-collapsed #ai-exporter-rail-master-eye {
                    width: 100%; height: 100%; border-radius: 50%; border: none; margin: 0;
                }

                /* ---------- Content column (Floating to side of rail) ---------- */
                #ai-exporter-content {
                    position: absolute;
                    right: ${Config.PANEL_CONTENT_OFFSET}px;
                    top: 0;
                    width: min(340px, 88vw);
                    max-height: min(78vh, 620px);
                    display: none;
                    flex-direction: column;
                    background: ${t.panelGradient};
                    border-radius: 14px;
                    box-shadow: ${t.shadow};
                    border: none;
                    overflow: hidden;
                }
                #ai-exporter-content.open { display: flex; }

                #ai-exporter-content-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 10px 10px 12px;
                    background: ${t.headerGradient};
                    border-bottom: 1px solid ${t.borderSoft};
                    flex-shrink: 0;
                }
                #ai-exporter-content-title {
                    flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; letter-spacing: -0.015em;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    color: ${t.textLight}; display: flex; align-items: center; gap: 8px;
                }
                #ai-exporter-content-body {
                    overflow-y: auto; overflow-x: hidden; padding: 10px;
                    display: flex; flex-direction: column; gap: 8px;
                }
                .ai-exporter-icon-btn {
                    background: #ffffff; border: 1px solid ${t.borderSoft};
                    color: ${t.textMuted}; border-radius: 7px; width: 26px; height: 26px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; font-size: 13px; flex-shrink: 0;
                }
                .ai-exporter-icon-btn:hover { background: #f5f5f5; color: ${t.textLight}; }
                .ai-exporter-btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
                .ai-exporter-btn {
                    flex: 1 1 auto; min-width: 74px; height: 32px;
                    border: none; border-radius: 8px; background: ${t.buttonGradient};
                    color: #fff; font-size: 12px; font-weight: 600; letter-spacing: -0.005em; cursor: pointer;
                    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
                    padding: 0 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                }
                .ai-exporter-btn:hover { background: ${t.buttonGradientHover}; }
                .ai-exporter-btn.secondary {
                    background: ${t.buttonSecondaryGradient}; color: ${t.textMuted};
                    border: 1px solid ${t.borderSoft}; box-shadow: none;
                }
                .ai-exporter-btn.secondary:hover { background: #f5f5f5; color: ${t.textLight}; }
                .ai-exporter-count-pill {
                    font-size: 10px; font-weight: 700; background: #f5f5f5;
                    color: ${t.textLight}; border: 1px solid ${t.borderSoft};
                    padding: 2px 7px; border-radius: 20px;
                }
                #${Config.DOM.PANEL_ID} input[type="text"], #${Config.DOM.PANEL_ID} textarea,
                #${Config.DOM.PANEL_ID} select, #${Config.DOM.PANEL_ID} input[type="number"],
                #${Config.DOM.PANEL_ID} input[type="password"] {
                    width: 100%; background: ${t.inputBg}; color: ${t.inputText};
                    border: 1px solid ${t.borderSoft}; border-radius: 6px;
                    padding: 6px 8px; font-size: 12px; font-family: inherit; line-height: 1.4;
                }
                #${Config.DOM.PANEL_ID} input[type="text"]:focus, #${Config.DOM.PANEL_ID} textarea:focus,
                #${Config.DOM.PANEL_ID} input[type="password"]:focus { outline: 2px solid #000000; }
                #${Config.DOM.PANEL_ID} textarea { resize: vertical; font-family: ${Theme.monoStack}; font-size: 11.5px; }
                .ai-exporter-select-all-row {
                    display: flex; align-items: center; gap: 6px; font-size: 11px;
                    color: ${t.textLight}; margin-bottom: 6px;
                }
                #${Config.DOM.OUTLINE_LIST_ID} {
                    max-height: 220px; overflow-y: auto; display: flex; flex-direction: column;
                    gap: 3px; margin-top: 6px;
                }
                .ai-exporter-msg-list {
                    max-height: 180px; overflow-y: auto; display: flex; flex-direction: column;
                    gap: 3px;
                }
                .ai-exporter-outline-item { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 5px; }
                .ai-exporter-outline-item:hover { background: #f5f5f5; }
                .ai-exporter-outline-item span {
                    cursor: pointer; font-size: 11.5px; line-height: 1.3;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .ai-exporter-shortcut-row {
                    display: flex; justify-content: space-between; gap: 14px;
                    font-size: 11.5px; padding: 3px 0; border-bottom: 1px dashed ${t.borderSoft};
                }
                .ai-exporter-shortcut-row:last-child { border-bottom: none; }
                .ai-exporter-kbd {
                    background: #f5f5f5; color: ${t.textLight}; border: 1px solid ${t.borderSoft};
                    border-radius: 5px; padding: 1px 6px; font-family: monospace; font-size: 11px;
                }
                .ai-exporter-status-line { font-size: 11px; line-height: 1.45; color: ${t.textMuted}; }
                .ai-exporter-preview-img {
                    width: 100%; max-height: 160px; object-fit: contain; background: #fff;
                    border-radius: 6px; border: 1px solid ${t.borderSoft}; margin-top: 6px; image-rendering: pixelated;
                    cursor: zoom-in; display: block;
                }
                .ai-exporter-preview-img:hover { box-shadow: 0 0 0 2px #000000; }

                /* Select with a visible chevron, so it reads as a dropdown. */
                .ai-exporter-select-wrap { position: relative; }
                #${Config.DOM.PANEL_ID} .ai-exporter-select-wrap select {
                    -webkit-appearance: none; -moz-appearance: none; appearance: none;
                    padding-right: 30px; cursor: pointer; background-image: none;
                }
                .ai-exporter-select-wrap svg {
                    position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
                    width: 14px; height: 14px; pointer-events: none; color: ${t.textMuted};
                }
                .ai-exporter-select-wrap:hover svg { color: ${t.textLight}; }

                /* ---------- Full-size image viewer (Snapcompact pages) ---------- */
                #ai-exporter-lightbox {
                    position: fixed; inset: 0; z-index: 2147483600;
                    background: rgba(10, 10, 10, 0.88); backdrop-filter: blur(3px);
                    display: flex; flex-direction: column;
                    font-family: ${Theme.fontStack}; font-size: 12.5px; color: #f5f5f5;
                    -webkit-font-smoothing: antialiased; cursor: zoom-out;
                }
                #ai-exporter-lightbox * { box-sizing: border-box; font-family: inherit; }
                #ai-exporter-lightbox .lb-bar {
                    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
                    padding: 10px 14px; padding-top: calc(10px + env(safe-area-inset-top, 0px));
                    background: rgba(0, 0, 0, 0.55); cursor: default;
                }
                #ai-exporter-lightbox .lb-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
                #ai-exporter-lightbox .lb-title { font-weight: 600; font-size: 13px; color: #ffffff; }
                #ai-exporter-lightbox .lb-sub { font-size: 11.5px; color: #a3a3a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                #ai-exporter-lightbox button {
                    height: 30px; min-width: 30px; padding: 0 10px; border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.08);
                    color: #ffffff; font-size: 12px; font-weight: 500; cursor: pointer;
                    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
                }
                #ai-exporter-lightbox button:hover { background: rgba(255, 255, 255, 0.2); }
                #ai-exporter-lightbox button:disabled { opacity: 0.35; cursor: default; }
                #ai-exporter-lightbox button svg { width: 16px; height: 16px; }
                #ai-exporter-lightbox .lb-stage {
                    flex: 1; min-height: 0; overflow: auto; display: flex;
                    padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
                }
                /* margin:auto centres when smaller and still scrolls from the top-left when larger. */
                #ai-exporter-lightbox canvas {
                    margin: auto; background: #ffffff; flex-shrink: 0;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); border-radius: 2px;
                }
                #ai-exporter-lightbox.fit canvas {
                    max-width: 100%; max-height: 100%; width: auto; height: auto; image-rendering: auto;
                }
                #ai-exporter-lightbox:not(.fit) canvas { image-rendering: pixelated; }
                #ai-exporter-lightbox .lb-hint { font-size: 11px; color: #8a8a8a; white-space: nowrap; }
                @media (max-width: 560px) { #ai-exporter-lightbox .lb-hint { display: none; } }
                .ai-exporter-section-label { font-size: 12px; font-weight: 600; display: block; margin-bottom: 4px; color: ${t.textLight}; }
                .ai-exporter-check-row { display: flex; align-items: center; gap: 7px; font-size: 12px; cursor: pointer; }
                .ai-exporter-check-row input { margin: 0; }
                .ai-exporter-radio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
                .ai-exporter-radio-card {
                    position: relative; display: flex; flex-direction: column; gap: 1px; cursor: pointer;
                    border: 1px solid rgba(0, 0, 0, 0.18); border-radius: 8px; padding: 6px 8px;
                }
                .ai-exporter-radio-card:has(input:checked) { border-color: #000000; box-shadow: inset 0 0 0 1px #000000; }
                .ai-exporter-radio-card input { position: absolute; opacity: 0; pointer-events: none; }
                .ai-exporter-radio-card b { font-size: 12px; font-weight: 600; }
                .ai-exporter-radio-card span { font-size: 10.5px; color: ${t.textMuted}; line-height: 1.3; }

                /* ---------- Prompt library ---------- */
                .ai-exporter-prompt-list {
                    display: flex; flex-direction: column; gap: 4px;
                    max-height: 260px; overflow-y: auto;
                }
                .ai-exporter-prompt-row {
                    display: flex; align-items: center; gap: 4px;
                    border: 1px solid ${t.borderSoft}; border-radius: 8px;
                    padding: 5px 6px; background: #ffffff;
                }
                .ai-exporter-prompt-row:hover { background: #f5f5f5; }
                .ai-exporter-prompt-main {
                    flex: 1; min-width: 0; cursor: pointer; text-align: left;
                    background: none; border: none; padding: 0; font-family: inherit;
                }
                .ai-exporter-prompt-title {
                    font-size: 12px; font-weight: 700; color: ${t.textLight};
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .ai-exporter-prompt-title.with-icon { display: flex; align-items: center; gap: 5px; }
                .ai-exporter-prompt-title.with-icon svg { flex-shrink: 0; }
                .ai-exporter-prompt-preview {
                    font-size: 10.5px; color: ${t.textMuted};
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .ai-exporter-prompt-actions { display: flex; gap: 2px; flex-shrink: 0; }
                .ai-exporter-mini-btn {
                    width: 22px; height: 22px; border-radius: 6px; cursor: pointer;
                    border: 1px solid ${t.borderSoft}; background: #ffffff;
                    color: ${t.textMuted}; font-size: 11px; line-height: 1;
                    display: flex; align-items: center; justify-content: center; padding: 0;
                }
                .ai-exporter-mini-btn:hover { background: #000000; color: #ffffff; border-color: #000000; }
                .ai-exporter-empty-note {
                    font-size: 11px; color: ${t.textMuted}; text-align: center;
                    padding: 10px 6px; border: 1px dashed ${t.borderSoft}; border-radius: 8px;
                }
                .ai-exporter-fieldset {
                    border: 1px solid ${t.borderSoft}; border-radius: 8px; padding: 8px;
                    display: flex; flex-direction: column; gap: 6px;
                }
                .ai-exporter-fieldset[hidden] { display: none; }
                .ai-exporter-icon-btn svg { width: 14px; height: 14px; }
                .ai-exporter-mini-btn svg { width: 12px; height: 12px; }

                /* ---------- Context meter ---------- */
                .ai-exporter-meter-status {
                    border: 1px solid ${t.borderSoft}; border-left: 6px solid var(--meter-color);
                    border-radius: 8px; padding: 8px 10px;
                }
                .ai-exporter-meter-status b { display: block; font-size: 14px; font-weight: 650; letter-spacing: -0.015em; color: var(--meter-color); }
                .ai-exporter-meter-status span { font-size: 11px; color: ${t.textMuted}; }
                .ai-exporter-meter-bar {
                    position: relative; height: 12px; border-radius: 6px;
                    background: #eeeeee; overflow: hidden; border: 1px solid rgba(0,0,0,0.15);
                }
                .ai-exporter-meter-fill {
                    height: 100%; width: 0; background: var(--meter-color);
                    transition: width 0.3s ease, background 0.3s ease;
                }
                .ai-exporter-meter-tick {
                    position: absolute; top: 0; bottom: 0; width: 2px;
                    background: rgba(0, 0, 0, 0.45);
                }
                .ai-exporter-meter-caption {
                    display: flex; justify-content: space-between; font-size: 11px;
                    color: ${t.textMuted};
                }
                .ai-exporter-meter-grid {
                    display: grid; grid-template-columns: 1fr auto; gap: 3px 10px;
                    font-size: 11.5px;
                }
                .ai-exporter-meter-grid span:nth-child(odd) { color: ${t.textMuted}; }
                .ai-exporter-meter-grid span:nth-child(even) { font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
                .ai-exporter-inline-fields { display: flex; gap: 6px; }
                .ai-exporter-inline-fields label { flex: 1; font-size: 11px; color: ${t.textMuted}; display: flex; flex-direction: column; gap: 2px; }

                .ai-exporter-divider {
                    border-top: 1px dashed ${t.borderSoft}; margin: 2px 0 0 0; padding-top: 6px;
                }

                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar { width: 7px; }
                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.4); border-radius: 6px; }
                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.05); }
                #${Config.DOM.PANEL_ID} { scrollbar-color: rgba(0, 0, 0, 0.4) rgba(0, 0, 0, 0.05); scrollbar-width: thin; }
            `;
      document.head.appendChild(style);

      /* Injected separately: the Quick Dock lives outside the Floating Dock,
       * over the host site's composer, so it cannot inherit its styles. */
      const quickStyle = document.createElement("style");
      quickStyle.id = "ai-exporter-quick-dock-styles";
      quickStyle.textContent = `
                #${Config.DOM.QUICKDOCK_ID} {
                    position: fixed;
                    z-index: 2147482000;
                    display: none;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 5px;
                    border-radius: 10px;
                    background: rgba(255, 255, 255, 0.96);
                    border: 1px solid rgba(0, 0, 0, 0.9);
                    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
                    font-family: ${Theme.fontStack};
                    color: ${t.textLight};
                    backdrop-filter: blur(6px);
                    max-width: calc(100vw - 16px);
                    box-sizing: border-box;
                    opacity: 0.55;
                    transition: opacity 0.15s ease;
                }
                #${Config.DOM.QUICKDOCK_ID}.visible { display: flex; }
                /* A site button sits where the full bar would go: shrink to the
                 * icons in the right corner, grow back leftward on hover. */
                #${Config.DOM.QUICKDOCK_ID} { width: var(--qd-width, auto); }
                #${Config.DOM.QUICKDOCK_ID}.tucked:not(:hover) { width: auto; }
                #${Config.DOM.QUICKDOCK_ID}.tucked:not(:hover) .qd-scroll { display: none; }
                /* Even the corner is taken: get out of the way entirely. */
                #${Config.DOM.QUICKDOCK_ID}.blocked { visibility: hidden; pointer-events: none; }
                /* A site menu is open over us: step aside without losing layout. */
                #${Config.DOM.QUICKDOCK_ID}.covered { visibility: hidden; pointer-events: none; }
                #${Config.DOM.QUICKDOCK_ID}:hover { opacity: 1; }
                #${Config.DOM.QUICKDOCK_ID} * { box-sizing: border-box; font-family: inherit; }
                #${Config.DOM.QUICKDOCK_ID} .qd-scroll {
                    display: flex; align-items: center; gap: 5px;
                    overflow-x: auto; overflow-y: hidden;
                    flex: 1; min-width: 0; scrollbar-width: none;
                    scroll-behavior: smooth;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-scroll::-webkit-scrollbar { height: 0; }
                #${Config.DOM.QUICKDOCK_ID} .qd-chip {
                    flex: 0 0 auto; max-width: 190px;
                    height: 24px; padding: 0 9px;
                    border-radius: 12px; border: 1px solid rgba(0, 0, 0, 0.25);
                    background: #ffffff; color: #000000;
                    font-size: 11.5px; font-weight: 500; font-family: inherit; letter-spacing: -0.005em;
                    cursor: pointer; white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-chip:hover { background: #000000; color: #ffffff; }
                #${Config.DOM.QUICKDOCK_ID} .qd-chip.qd-skill {
                    display: inline-flex; align-items: center; gap: 4px; border-style: dashed;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-chip.qd-skill svg { flex-shrink: 0; }
                #${Config.DOM.QUICKDOCK_ID} .qd-icon {
                    flex: 0 0 auto;
                    width: 24px; height: 24px; padding: 0;
                    border-radius: 8px; border: 1px solid rgba(0, 0, 0, 0.25);
                    background: #ffffff; color: #000000;
                    font-size: 13px; font-weight: 700; line-height: 1; font-family: inherit;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-icon:hover { background: #000000; color: #ffffff; }
                #${Config.DOM.QUICKDOCK_ID} .qd-empty {
                    font-size: 11px; color: ${t.textMuted}; white-space: nowrap; padding: 0 4px;
                }
                /* Narrow composers (mobile / split panes): drop the hint text. */
                #${Config.DOM.QUICKDOCK_ID}.compact .qd-empty { display: none; }
                #${Config.DOM.QUICKDOCK_ID} .qd-tools {
                    display: flex; align-items: center; gap: 4px; flex: 0 0 auto;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-icon svg { width: 14px; height: 14px; display: block; }
                #${Config.DOM.QUICKDOCK_ID} .qd-icon:disabled { opacity: 0.4; cursor: progress; }
                #${Config.DOM.QUICKDOCK_ID} .qd-sep {
                    width: 1px; height: 16px; background: rgba(0, 0, 0, 0.2); flex: 0 0 auto;
                }
                /* Context meter: a plain traffic light. Details live in the Floating Dock. */
                #${Config.DOM.QUICKDOCK_ID} .qd-meter-dot {
                    width: 11px; height: 11px; border-radius: 50%;
                    background: ${t.meterOk}; box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2);
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-meter[data-level="warn"] .qd-meter-dot {
                    background: ${t.meterWarn}; box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.25);
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-meter[data-level="crit"] .qd-meter-dot {
                    background: ${t.meterCrit}; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.25);
                    animation: qd-pulse 1.4s ease-in-out infinite;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-meter:hover .qd-meter-dot { box-shadow: 0 0 0 2px #ffffff; }
                /* Red is worth seeing without hovering. */
                #${Config.DOM.QUICKDOCK_ID}.level-crit { opacity: 0.9; }
                @keyframes qd-pulse { 50% { transform: scale(0.7); } }
                #${Config.DOM.QUICKDOCK_ID} .qd-toast {
                    position: absolute; right: 0; bottom: calc(100% + 4px);
                    background: #000000; color: #ffffff; font-size: 11px; font-weight: 600;
                    padding: 4px 8px; border-radius: 6px; white-space: nowrap;
                    pointer-events: none; opacity: 0; transition: opacity 0.15s ease;
                }
                #${Config.DOM.QUICKDOCK_ID} .qd-toast.show { opacity: 1; }
      `;
      document.head.appendChild(quickStyle);
    },
  };

  /* ==========================================================================
   * 2b. ICONS — inline SVG glyphs (shapes from Lucide, ISC licence).
   *
   * Built node by node with createElementNS instead of an HTML string: Gemini
   * enforces Trusted Types, which throws on any markup assigned to the DOM.
   * ========================================================================== */
  const Icons = {
    // 24x24 stroke grid. A string is a <path d>; an array is [tag, attributes].
    glyphs: {
      grip: [
        ["circle", { cx: 5, cy: 9, r: 1 }], ["circle", { cx: 12, cy: 9, r: 1 }],
        ["circle", { cx: 19, cy: 9, r: 1 }], ["circle", { cx: 5, cy: 15, r: 1 }],
        ["circle", { cx: 12, cy: 15, r: 1 }], ["circle", { cx: 19, cy: 15, r: 1 }],
      ],
      library: [
        "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",
        "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
      ],
      markdown: [
        "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
        "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8",
      ],
      json: [
        "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
        "M14 2v4a2 2 0 0 0 2 2h4",
        "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1",
        "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1",
      ],
      sliders: [
        "M21 4h-7", "M10 4H3", "M21 12h-9", "M8 12H3", "M21 20h-5", "M12 20H3",
        "M14 2v4", "M8 10v4", "M16 18v4",
      ],
      toon: [
        "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
        "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
      ],
      minify: [
        "m15 15 6 6m-6-6v4.8m0-4.8h4.8", "M9 19.8V15m0 0H4.2M9 15l-6 6",
        "M15 4.2V9m0 0h4.8M15 9l6-6", "M9 4.2V9m0 0H4.2M9 9 3 3",
      ],
      image: [
        ["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
        ["circle", { cx: 9, cy: 9, r: 2 }],
        "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
      ],
      quick: [
        "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
      ],
      gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
      scrollTop: ["M5 3h14", "m18 13-6-6-6 6", "M12 7v14"],
      eye: [
        "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
        ["circle", { cx: 12, cy: 12, r: 3 }],
      ],
      close: ["M18 6 6 18", "m6 6 12 12"],
      copy: [
        ["rect", { x: 8, y: 8, width: 14, height: 14, rx: 2 }],
        "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
      ],
      edit: [
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      ],
      trash: [
        "M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
        "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
      ],
      chevronDown: ["m6 9 6 6 6-6"],
      chevronLeft: ["m15 18-6-6 6-6"],
      chevronRight: ["m9 18 6-6-6-6"],
      maximize: ["M15 3h6v6", "M9 21H3v-6", "m21 3-7 7", "m3 21 7-7"],
      handoff: [
        "M21 12v3a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h7", "M16 3h5v5", "m16 8 5-5",
      ],
      flask: [
        "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2",
        "M6.453 15h11.094", "M8.5 2h7",
      ],
      bookmarkPlus: [
        "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z", "M12 7v6", "M15 10H9",
      ],
      skill: [
        "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
        "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3",
      ],
      upload: ["M12 3v12", "m17 8-5-5-5 5", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"],
    },

    /** @returns {SVGSVGElement} a currentColor stroke icon. */
    make(name, size = 16) {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      const attrs = {
        viewBox: "0 0 24 24", width: size, height: size, fill: "none",
        stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
        "stroke-linejoin": "round", "aria-hidden": "true",
      };
      Object.entries(attrs).forEach(([k, v]) => svg.setAttribute(k, v));
      (Icons.glyphs[name] || []).forEach((part) => {
        const [tag, shapeAttrs] = typeof part === "string" ? ["path", { d: part }] : part;
        const node = document.createElementNS(NS, tag);
        Object.entries(shapeAttrs).forEach(([k, v]) => node.setAttribute(k, v));
        svg.appendChild(node);
      });
      return svg;
    },
  };

  /* ==========================================================================
   * 3. UTILS — pure, stateless helpers. No DOM mutation, no platform knowledge.
   * ========================================================================== */
  const Utils = {
    slugify(str, toLowerCase = true, maxLength = 120) {
      if (typeof str !== "string") return "invalid-filename";
      if (toLowerCase) str = str.toLocaleLowerCase();
      return str
        .replace(/[^a-zA-Z0-9\-_.+]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .replace(/^$/, "invalid-filename")
        .slice(0, maxLength);
    },

    formatLocalTime(d) {
      const pad = (n) => String(n).padStart(2, "0");
      const tzOffsetMin = -d.getTimezoneOffset();
      const sign = tzOffsetMin >= 0 ? "+" : "-";
      const absOffset = Math.abs(tzOffsetMin);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}${pad(absOffset % 60)}`;
    },

    truncate(str, len = 70) {
      return str.length <= len ? str : str.slice(0, len).trim() + "…";
    },

    /**
     * Rough token count without a tokenizer: ~4 ASCII characters per token,
     * and one per non-ASCII character (CJK, emoji and the like tokenize far
     * worse than English). Good enough for a traffic light, not for billing.
     */
    estimateTokens(text) {
      if (!text) return 0;
      let ascii = 0;
      let other = 0;
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 128) ascii++;
        else other++;
      }
      return Math.ceil(ascii / 4 + other);
    },

    /** Fast 32-bit FNV-1a, for spotting an unchanged transcript. */
    hash(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(36) + str.length.toString(36);
    },

    /** 950 -> "950", 4210 -> "4.2k", 152000 -> "152k". */
    formatTokens(n) {
      if (n < 1000) return String(n);
      if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
      return `${Math.round(n / 1000)}k`;
    },

    escapeMd(text) {
      return text.replace(/[|\\`*_{}\[\]()#+\-!>]/g, "\\$&");
    },

    downloadFile(filename, text, mimeType = "text/plain;charset=utf-8") {
      Utils.downloadBlob(filename, new Blob([text], { type: mimeType }));
    },

    downloadBlob(filename, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    /**
     * Expands {platform}/{title}/{timestamp}/{tags}/{tagN}/{exporter}
     * placeholders into a safe filename.
     */
    formatFileName(format, title, tags, ext, platformId) {
      const tagsArray = Array.isArray(tags) ? tags : [];
      const replacements = {
        "{exporter}": Config.VERSION,
        "{platform}": platformId,
        "{title}": title.slice(0, 70).toLocaleLowerCase(),
        "{timestamp}": new Date().toISOString(),
        "{timestampLocal}": Utils.formatLocalTime(new Date()),
        "{tags}": tagsArray.join("-").toLocaleLowerCase(),
      };
      for (let i = 0; i < 9; i++) {
        replacements[`{tag${i + 1}}`] = tagsArray[i]
          ? tagsArray[i].toLocaleLowerCase()
          : "";
      }
      let formattedFilename = format;
      for (const placeholder in replacements) {
        if (Object.prototype.hasOwnProperty.call(replacements, placeholder)) {
          formattedFilename = formattedFilename
            .split(placeholder)
            .join(replacements[placeholder]);
        }
      }
      return Utils.slugify(
        `${formattedFilename.replace(/(_+|-+)$/, "")}.${ext}`,
        false,
      );
    },

    /**
     * Splits "#tag1 My chat title #tag2" into { title: "My chat title", tags:
     * ["tag1","tag2"] }.
     */
    parseChatTitleAndTags(rawTitle) {
      const tags = [];
      let cleanedTitle = rawTitle.trim();
      let match;
      const tagRegex = /(^|\s+)#(\S+)/g;
      while ((match = tagRegex.exec(cleanedTitle)) !== null) {
        if (!/^\d+$/.test(match[2])) tags.push(match[2]);
      }
      cleanedTitle = cleanedTitle
        .replace(/(^|\s+)#\S+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { title: cleanedTitle, tags };
    },

    getCleanUrl() {
      try {
        return window.location.origin + window.location.pathname;
      } catch (e) {
        return window.location.href;
      }
    },
  };

  /* ==========================================================================
   * 4. NET — one HTTP entry point for the whole script.
   *
   * AI chat sites ship strict Content-Security-Policies, so a plain fetch() to
   * api.github.com is usually blocked before it leaves the page. GM_xmlhttpRequest
   * runs outside the page context and is not subject to that CSP, so it is the
   * preferred path; fetch() is only a fallback for when the userscript stub was
   * installed without the @grant.
   * ========================================================================== */
  const Net = {
    /** @returns {Promise<{status:number, text:string}>} */
    request({ method = "GET", url, headers = {}, body = null, responseType = "" }) {
      return new Promise((resolve, reject) => {
        // A stub may grant either spelling; GM.xmlHttpRequest is the GM4 form.
        const gmXhr =
          typeof GM_xmlhttpRequest === "function"
            ? GM_xmlhttpRequest
            : typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function"
              ? GM.xmlHttpRequest
              : null;
        if (gmXhr) {
          gmXhr({
            method,
            url,
            headers,
            data: body,
            timeout: Config.GIST.TIMEOUT_MS,
            ...(responseType ? { responseType } : {}),
            onload: (res) =>
              resolve({
                status: res.status,
                text: responseType ? "" : res.responseText || "",
                body: res.response,
              }),
            onerror: () =>
              reject(
                new Error(
                  "Network error. Check that your Tampermonkey stub grants " +
                    `GM_xmlhttpRequest and @connect ${new URL(url).hostname}.`,
                ),
              ),
            ontimeout: () => reject(new Error("Request timed out.")),
          });
          return;
        }
        fetch(url, { method, headers, body })
          .then((r) =>
            responseType === "arraybuffer"
              ? r.arrayBuffer().then((buf) => resolve({ status: r.status, text: "", body: buf }))
              : r.text().then((text) => resolve({ status: r.status, text })),
          )
          .catch((e) => {
            // Say which environment we are in: grants written inside this
            // @require'd file are ignored, only the installed stub's count.
            const handler =
              typeof GM_info !== "undefined" && GM_info ? GM_info.scriptHandler : "";
            const hint =
              handler === "bookmarklet"
                ? "Bookmarklets cannot bypass it — use desktop Tampermonkey instead."
                : "GM_xmlhttpRequest is not granted to this script. Grants inside " +
                  "AiUtil.js are ignored when it is loaded via @require — add " +
                  `'// @grant GM_xmlhttpRequest' and '// @connect ${new URL(url).hostname}' ` +
                  "to the installed stub's header in the Tampermonkey editor, save, " +
                  "and reload the page.";
            reject(new Error(`${e.message} — the page's CSP blocked it. ${hint}`));
          });
      });
    },

    /** Same as request(), but parses JSON and turns non-2xx into an Error. */
    async json(opts) {
      const res = await Net.request(opts);
      let parsed = null;
      try {
        parsed = res.text ? JSON.parse(res.text) : null;
      } catch (e) {
        if (res.status >= 200 && res.status < 300)
          throw new Error("GitHub returned a non-JSON response.");
      }
      if (res.status < 200 || res.status >= 300) {
        const detail = (parsed && parsed.message) || res.text.slice(0, 200);
        throw new Error(`HTTP ${res.status}: ${detail || "request failed"}`);
      }
      return parsed;
    },
  };

  /* ==========================================================================
   * 5. LIB — small vendored libraries. Framework-agnostic, no Config/Theme deps.
   * ========================================================================== */
  const Lib = {};

  /**
   * Minimal Turndown-style HTML -> Markdown converter driven by pluggable
   * rules.
   */
  Lib.TurndownService = class TurndownService {
    constructor(options = {}) {
      this.rules = [];
      this.options = {
        headingStyle: "atx",
        hr: "___",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        ...options,
      };
    }
    addRule(key, rule) {
      this.rules.push({ key, ...rule });
    }
    turndown(rootNode) {
      const process = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        const rule = this.rules.find(
          (r) =>
            (typeof r.filter === "string" &&
              r.filter === node.nodeName.toLowerCase()) ||
            (Array.isArray(r.filter) &&
              r.filter.includes(node.nodeName.toLowerCase())) ||
            (typeof r.filter === "function" && r.filter(node)),
        );
        const content = Array.from(node.childNodes)
          .map((n) => process(n))
          .join("");
        if (rule) return rule.replacement(content, node, this.options);
        return content;
      };
      const parsedRootNode =
        typeof rootNode === "string"
          ? new DOMParser().parseFromString(rootNode, "text/html").body
          : rootNode;
      return Array.from(parsedRootNode.childNodes)
        .map((n) => process(n))
        .join("")
        .trim()
        .replace(/\n{3,}/g, "\n\n");
    }
  };

  /**
   * Converts arbitrary JSON into a compact TOON (Token-Oriented Object
   * Notation) string.
   */
  Lib.jsonToToon = function jsonToToon(obj, indent = 0) {
    const nextSpaces = " ".repeat(indent + 1);
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "boolean" || typeof obj === "number") return String(obj);
    if (typeof obj === "string") {
      const escaped = obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return /[\n,:"]/.test(escaped) || escaped === ""
        ? `"${escaped}"`
        : escaped;
    }
    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]";
      const allObjects = obj.every(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      );
      if (allObjects && obj.length > 0) {
        const firstKeys = Object.keys(obj[0]);
        const uniform = obj.every((item) => {
          const keys = Object.keys(item);
          return (
            keys.length === firstKeys.length &&
            firstKeys.every((k) => keys.includes(k))
          );
        });
        if (uniform) {
          const rows = obj.map((item) =>
            firstKeys
              .map((k) =>
                item[k] === null || item[k] === undefined
                  ? ""
                  : jsonToToon(item[k], 0),
              )
              .join(","),
          );
          return rows.map((row) => `${nextSpaces}${row}`).join("\n");
        }
      }
      return obj
        .map((item) => `${nextSpaces}- ${jsonToToon(item, indent + 1)}`)
        .join("\n");
    }
    if (typeof obj === "object") {
      const entries = Object.entries(obj);
      if (entries.length === 0) return "{}";
      return entries
        .map(([key, value]) =>
          typeof value === "object" && value !== null
            ? `${nextSpaces}${key}:\n${jsonToToon(value, indent + 1)}`
            : `${nextSpaces}${key}: ${jsonToToon(value, indent + 1)}`,
        )
        .join("\n");
    }
    return String(obj);
  };

  /* ==========================================================================
   * 6. SNAPCOMPACT — renders serialized chat text into dense PNG "pages".
   * ========================================================================== */
  const Snapcompact = {
    FONT_FAMILY: '"Courier New", Courier, monospace',
    FRAME_WIDTH: 1568,
    MAX_FRAME_HEIGHT: 1568,
    LINE_HEIGHT_RATIO: 1.15,
    BG: "#ffffff",
    FG: "#000000",

    /**
     * Flattens messages to "U:"/"A:" lines, converting JSON payloads to TOON
     * and collapsing whitespace.
     */
    serialize(messages) {
      return messages
        .map((m) => {
          const tag = m.author === "user" ? "U" : "A";
          let text = (m.contentText || "").trim();
          try {
            const firstChar = text.charAt(0);
            const lastChar = text.charAt(text.length - 1);
            if (
              (firstChar === "{" && lastChar === "}") ||
              (firstChar === "[" && lastChar === "]")
            ) {
              text = Lib.jsonToToon(JSON.parse(text));
            }
          } catch (e) {
            /* not JSON — fall through to plain text */
          }
          text = text.replace(/\s+/g, " ").trim();
          return `${tag}: ${text}`;
        })
        .join("\n");
    },

    measure(ctx, fontSizePx) {
      ctx.font = `${fontSizePx}px ${this.FONT_FAMILY}`;
      return {
        w: ctx.measureText("0").width,
        h: Math.ceil(fontSizePx * this.LINE_HEIGHT_RATIO),
      };
    },

    wrap(text, cols) {
      const lines = [];
      for (const raw of text.split("\n")) {
        if (raw.length === 0) {
          lines.push("");
          continue;
        }
        for (let i = 0; i < raw.length; i += cols)
          lines.push(raw.slice(i, i + cols));
      }
      return lines;
    },

    renderPages(
      text,
      {
        fontSizePx = 10,
        frameWidth = this.FRAME_WIDTH,
        maxFrameHeight = this.MAX_FRAME_HEIGHT,
      } = {},
    ) {
      const mctx = document.createElement("canvas").getContext("2d");
      const { w: charW, h: lineH } = this.measure(mctx, fontSizePx);
      const cols = Math.max(1, Math.floor(frameWidth / charW));
      const rowsPerFrame = Math.max(1, Math.floor(maxFrameHeight / lineH));
      const allLines = this.wrap(text, cols);
      const pages = [];
      for (let start = 0; start < allLines.length; start += rowsPerFrame) {
        const pageLines = allLines.slice(start, start + rowsPerFrame);
        const canvas = document.createElement("canvas");
        canvas.width = frameWidth;
        canvas.height = Math.max(lineH, pageLines.length * lineH);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = this.BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSizePx}px ${this.FONT_FAMILY}`;
        ctx.textBaseline = "top";
        ctx.fillStyle = this.FG;
        pageLines.forEach((line, i) => ctx.fillText(line, 0, i * lineH));
        pages.push({
          canvas,
          chars: pageLines.join("\n").length,
          cols,
          rows: pageLines.length,
        });
      }
      return pages;
    },

    estimateTokens(canvas) {
      return Math.ceil((canvas.width * canvas.height) / 750);
    },
  };

  /* ==========================================================================
     * 7. PLATFORMS — one adapter per AI chat site. THIS IS THE EXTENSION POINT.
     *
     * Each provider implements a small, consistent interface:
     *   {
     *     id            : string                     — unique key
     *     hostnames     : string[]                    — for host matching
     *     newChatUrl    : string                      — used by Snapcompact "open new chat"
     *     titleFromDoc(doc)               -> string    — raw chat title before tag parsing
     *     extractMessages(doc)            -> Message[] — { id, author, contentHtml, contentText, originalIndex }
     *     registerTurndownRules(turndown) -> void       — optional, platform-specific MD rules
     *     onAfterInit()                   -> void       — optional, e.g. Gemini auto-scroll
     *   }
     *
     * ChatExporter and UI never branch on "if platform === X" — they only ever
     * call through this interface, so adding a new site never touches them.
     * ========================================================================== */
  const Platforms = { registry: {} };

  function makeMessage(author, chatIndex, contentHtml, contentText) {
    return {
      id: `${author}-${chatIndex}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      author,
      contentHtml,
      contentText,
      timestamp: new Date(),
      originalIndex: chatIndex,
    };
  }

  // ---- ChatGPT --------------------------------------------------------------
  Platforms.registry.chatgpt = {
    id: "chatgpt",
    hostnames: ["chat.openai.com", "chatgpt.com"],
    newChatUrl: "https://chatgpt.com/",
    // Ordered best-guess first; Composer.find() takes the first visible hit.
    composerSelectors: [
      "#prompt-textarea",
      "form div[contenteditable='true']",
      "form textarea",
    ],
    selectors: {
      article:
        "section[data-turn-role], section[data-testid^='conversation-turn-']",
      header: "h4",
      popupDiv: "popover",
      buttonSpecificClass: "text-sm",
    },
    titleFromDoc(doc) {
      return (
        doc.title.replace(" - ChatGPT", "").trim() || Config.DEFAULT_CHAT_TITLE
      );
    },
    extractMessages(doc) {
      const articles = [...doc.querySelectorAll(this.selectors.article)];
      const messages = [];
      let chatIndex = 1;
      for (const article of articles) {
        const isUser =
          article.getAttribute("data-turn") === "user" ||
          (
            article.querySelector(this.selectors.header)?.textContent?.trim() ||
            ""
          )
            .toLowerCase()
            .includes("you said");
        const contentHtml =
          article.querySelector(".markdown, .whitespace-pre-wrap") || article;
        const contentText = contentHtml.innerText.trim();
        if (!contentText) continue;
        messages.push(
          makeMessage(
            isUser ? "user" : "ai",
            chatIndex,
            contentHtml,
            contentText,
          ),
        );
        if (!isUser) chatIndex++;
      }
      return messages;
    },
    registerTurndownRules(turndown) {
      const sel = this.selectors;
      turndown.addRule("chatgptRemoveReactions", {
        filter: (node) =>
          node.nodeName === "DIV" &&
          node.querySelector(
            ':scope > div:nth-child(1) > button[data-testid="copy-turn-action-button"]',
          ),
        replacement: () => "",
      });
      turndown.addRule("chatgptRemoveH6ChatGPTSaid", {
        filter: (node) =>
          node.nodeName === "H6" &&
          node.classList.contains("sr-only") &&
          node.textContent.trim().toLowerCase().startsWith("chatgpt said"),
        replacement: () => "",
      });
      turndown.addRule("popup-div", {
        filter: (node) =>
          node.nodeName === "DIV" && node.classList.contains(sel.popupDiv),
        replacement: (content) =>
          "\n```\n" +
          content
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|h[1-6]|ul|ol|li)>/gi, "\n")
            .replace(/<(?:p|div|h[1-6]|ul|ol|li)[^>]*>/gi, "\n")
            .replace(/<\/?[^>]+(>|$)/g, "")
            .replace(/\n+/g, "\n") +
          "\n```\n",
      });
      turndown.addRule("buttonWithSpecificClass", {
        filter: (node) =>
          node.nodeName === "BUTTON" &&
          node.classList.contains(sel.buttonSpecificClass),
        replacement: (content) => (content.trim() ? `__${content}__\n\n` : ""),
      });
      turndown.addRule("pre", {
        filter: "pre",
        replacement: (content, node) => {
          let codeText =
            node.querySelector(".cm-content")?.innerText ||
            node.querySelector("code")?.textContent ||
            "";
          let lang =
            node
              .querySelector(
                ".text-token-text-primary, .flex.items-center.text-token-text-secondary, .text-xs.font-sans",
              )
              ?.querySelector("span")
              ?.textContent.trim() ||
            node
              .querySelector(
                ".text-token-text-primary, .flex.items-center.text-token-text-secondary, .text-xs.font-sans",
              )
              ?.textContent.replace(/Copy code|Run/gi, "")
              .trim() ||
            "";
          if (!codeText && !node.querySelector("code")) return content;
          if (!lang && node.querySelector("code")?.className)
            lang =
              (node.querySelector("code").className.match(/language-(\w+)/) ||
                [])[1] || "";
          return `${node.previousElementSibling?.nodeName === "P" && node.previousElementSibling.closest("li")?.contains(node) ? "\n\n" : "\n"}\`\`\`${lang.toLowerCase()}\n${codeText.trim()}\n\`\`\`\n`;
        },
      });
    },
  };

  // ---- Claude -----------------------------------------------------------
  Platforms.registry.claude = {
    id: "claude",
    hostnames: ["claude.ai"],
    newChatUrl: "https://claude.ai/new",
    composerSelectors: [
      "div[contenteditable='true'].ProseMirror",
      "fieldset div[contenteditable='true']",
      "div[contenteditable='true']",
    ],
    selectors: {
      message:
        ".font-claude-response:not(#markdown-artifact), [data-testid='user-message']",
      userMessage: '[data-testid="user-message"]',
      thinkingBlockClass: "transition-all",
      artifactBlockCell: ".artifact-block-cell",
    },
    titleFromDoc(doc) {
      return (doc.title || Config.DEFAULT_CHAT_TITLE)
        .replace(/\s-\sClaude$/, "")
        .trim();
    },
    extractMessages(doc) {
      const items = [...doc.querySelectorAll(this.selectors.message)];
      const messages = [];
      let chatIndex = 1;
      items.forEach((item) => {
        const isUser = item.matches(this.selectors.userMessage);
        let contentHtml = item;
        let contentText = item.innerText.trim();
        if (!isUser) {
          contentHtml = document.createElement("div");
          Array.from(item.children).forEach((child) => {
            const isThinking = child.className.includes(
              this.selectors.thinkingBlockClass,
            );
            const isArtifact =
              (child.className.includes("pt-3") &&
                child.className.includes("pb-3")) ||
              child.querySelector(this.selectors.artifactBlockCell);
            if (!isThinking && !isArtifact) {
              const grid = child.querySelector(".grid-cols-1");
              if (grid) contentHtml.appendChild(grid.cloneNode(true));
            }
          });
          contentText = contentHtml.innerText.trim();
        }
        if (contentText) {
          messages.push(
            makeMessage(
              isUser ? "user" : "ai",
              chatIndex,
              contentHtml,
              contentText,
            ),
          );
          if (!isUser) chatIndex++;
        }
      });
      return messages;
    },
    registerTurndownRules(turndown) {
      turndown.addRule("claudeCodeBlock", {
        filter: (node) =>
          node.nodeName === "DIV" &&
          node.querySelector(":scope > div:nth-child(2)") &&
          node.querySelector(":scope > div:nth-child(3) > pre > code"),
        replacement: (content, node) =>
          "\n\n```" +
          (node
            .querySelector(":scope > div:nth-child(2)")
            ?.textContent.trim()
            .toLowerCase() || "") +
          "\n" +
          (node.querySelector(":scope > div:nth-child(3) > pre > code")
            ?.textContent || "") +
          "\n```\n\n",
      });
    },
  };

  // ---- Copilot ------------------------------------------------------------
  Platforms.registry.copilot = {
    id: "copilot",
    hostnames: ["www.copilot.com"],
    newChatUrl: "https://copilot.microsoft.com/",
    composerSelectors: [
      "textarea#userInput",
      "textarea[data-testid='composer-input']",
      "form textarea",
    ],
    selectors: {
      message: ".group\\/user-message, .group\\/ai-message",
      userMessage: ".group\\/user-message",
    },
    titleFromDoc(doc) {
      return (
        doc
          .querySelector('[role="option"][aria-selected="true"]')
          ?.querySelector("p")
          ?.textContent.trim() ||
        doc
          .querySelector('[role="option"][aria-selected="true"]')
          ?.getAttribute("aria-label")
          ?.split(",")
          .slice(1)
          .join(",")
          .trim() ||
        (doc.title || "")
          .replace(/^\s*Microsoft[_\s-]*Copilot.*$/i, "")
          .replace(/\s*[-–|]\s*Copilot.*$/i, "")
          .trim() ||
        "Copilot Conversation"
      );
    },
    extractMessages(doc) {
      const items = [...doc.querySelectorAll(this.selectors.message)];
      const messages = [];
      let chatIndex = 1;
      for (const item of items) {
        const isUser = item.matches(this.selectors.userMessage);
        const contentElem = isUser
          ? item.querySelector('[data-content="user-message"]')
          : item.querySelector(".group\\/ai-message-item");
        if (!contentElem) continue;
        messages.push(
          makeMessage(
            isUser ? "user" : "ai",
            chatIndex,
            isUser ? contentElem : contentElem.cloneNode(true),
            contentElem.innerText.trim(),
          ),
        );
        if (!isUser) chatIndex++;
      }
      return messages;
    },
    registerTurndownRules(turndown) {
      turndown.addRule("copilotRemoveReactions", {
        filter: (node) =>
          node.matches('[data-testid="message-item-reactions"]'),
        replacement: () => "",
      });
      turndown.addRule("copilotCodeBlock", {
        filter: (node) =>
          node.nodeName === "DIV" &&
          node.querySelector(":scope > div:nth-child(1) span") &&
          node.querySelector(":scope > div:nth-child(2) > div > pre"),
        replacement: (content, node) =>
          "\n\n```" +
          (node
            .querySelector(":scope > div:nth-child(1) span")
            ?.textContent.trim()
            .toLowerCase() || "") +
          "\n" +
          (node.querySelector(":scope > div:nth-child(2) > div > pre > code")
            ?.textContent || "") +
          "\n```\n\n",
      });
      turndown.addRule("copilotFooterLinks", {
        filter: (node) =>
          node.nodeName === "A" &&
          node.querySelector(":scope > span:nth-child(1)") &&
          node.querySelector(":scope > img:nth-child(2)") &&
          node.querySelector(":scope > span:nth-child(3)"),
        replacement: (content, node) =>
          `[${node.querySelector(":scope > span:nth-child(3)")?.textContent.trim() || node.getAttribute("href")}](${node.getAttribute("href")}) `,
      });
    },
  };

  // ---- Gemini ---------------------------------------------------------------
  Platforms.registry.gemini = {
    id: "gemini",
    hostnames: ["gemini.google.com"],
    newChatUrl: "https://gemini.google.com/app",
    composerSelectors: [
      "rich-textarea div.ql-editor[contenteditable='true']",
      "div.ql-editor[contenteditable='true']",
      "div[contenteditable='true']",
    ],
    hasAutoScroll: true, // Gemini lazy-loads history upward; needs the auto-scroll feature.
    selectors: {
      messageItem: "user-query, model-response",
      sidebarActiveChat:
        'a[data-test-id="conversation"].selected .conversation-title',
      topbarActiveChat: "conversation-actions .conversation-title",
    },
    titleFromDoc(doc) {
      let title =
        doc
          .querySelector(this.selectors.sidebarActiveChat)
          ?.textContent.trim() ||
        doc
          .querySelector(this.selectors.topbarActiveChat)
          ?.textContent.trim() ||
        doc.title;
      if (title.startsWith("Gemini - "))
        title = title.replace("Gemini - ", "").trim();
      const prefix = Store.get(
        Config.GM_KEYS.CHAT_TITLE_PREFIX,
        Config.DEFAULT_CHAT_TITLE_PREFIX,
      );
      if (prefix && title.startsWith(prefix.trim())) {
        title = title
          .replace(
            new RegExp(
              `^${prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
            ),
            "",
          )
          .trim();
      }
      return title;
    },
    extractMessages(doc) {
      const items = [...doc.querySelectorAll(this.selectors.messageItem)];
      const messages = [];
      let chatIndex = 1;
      for (const item of items) {
        const isUser = item.tagName.toLowerCase() === "user-query";
        const contentElem = isUser
          ? item.querySelector("div.query-content")
          : item.querySelector("message-content");
        if (!contentElem) continue;
        messages.push(
          makeMessage(
            isUser ? "user" : "ai",
            chatIndex,
            contentElem,
            contentElem.innerText.replace(/^you said\s+/i, "").trim(),
          ),
        );
        if (!isUser) chatIndex++;
      }
      return messages;
    },
    /**
     * Gemini has no reliable title while the first turn is still streaming —
     * derive one from the first question.
     */
    deriveTitleFallback(title, messages) {
      if (
        title !== Config.DEFAULT_CHAT_TITLE ||
        messages.length === 0 ||
        messages[0].author !== "user"
      )
        return title;
      const words = messages[0].ntentText
        .split(/\s+/)
        .filter((w) => w.length > 0);
      if (words.length === 0) return title;
      const slice =
        words.length > 1 && words.slice(0, 7).join(" ").length < 5
          ? words.slice(0, 10)
          : words.slice(0, 7);
      return (
        slice
          .join(" ")
          .replace(/[,.;:!?\-+]$/, "")
          .trim() || title
      );
    },
    registerTurndownRules(turndown) {
      turndown.addRule("geminiCodeLanguageLabel", {
        filter: (node) =>
          node.nodeName === "SPAN" &&
          node.closest(".code-block-decoration") &&
          node.textContent.trim().length > 0,
        replacement: () => "",
      });
      turndown.addRule("pre", {
        filter: "pre",
        replacement: (content, node) => {
          const codeText =
            node.querySelector(".cm-content")?.innerText ||
            node.querySelector("code")?.textContent ||
            "";
          const lang =
            node
              .closest(".code-block")
              ?.querySelector(".code-block-decoration span")
              ?.textContent.trim() || "";
          if (!codeText && !node.querySelector("code")) return content;
          return `\n\`\`\`${lang.toLowerCase()}\n${codeText.trim()}\n\`\`\`\n`;
        },
      });
    },
  };

  // ---- Grok -------------------------------------------------------------
  Platforms.registry.grok = {
    id: "grok",
    hostnames: ["grok.com"],
    newChatUrl: "https://grok.com/",
    composerSelectors: [
      "form textarea",
      "textarea[aria-label]",
      "div[contenteditable='true']",
    ],
    selectors: {
      message: "div[id^='response-']",
      content: ".response-content-markdown",
      userIndicator: ".items-end",
    },
    titleFromDoc(doc) {
      return (doc.title || Config.DEFAULT_CHAT_TITLE)
        .replace(/\s-\sGrok$/, "")
        .trim();
    },
    extractMessages(doc) {
      const items = [...doc.querySelectorAll(this.selectors.message)];
      const messages = [];
      let chatIndex = 1;
      for (const item of items) {
        const isUser = item.matches(this.selectors.userIndicator);
        const contentElem = item.querySelector(this.selectors.content);
        if (!contentElem) continue;
        const textSource = isUser
          ? contentElem
          : item.querySelector(".response-content-markdown") || contentElem;
        messages.push(
          makeMessage(
            isUser ? "user" : "ai",
            chatIndex,
            isUser ? contentElem : contentElem.cloneNode(true),
            textSource.innerText.trim(),
          ),
        );
        if (!isUser) chatIndex++;
      }
      return messages;
    },
    registerTurndownRules(turndown) {
      turndown.addRule("grokPreserveNewlines", {
        filter: (node) =>
          node.nodeName === "P" &&
          node.getAttribute("style")?.includes("white-space: pre-wrap"),
        replacement: (content) =>
          `\n\n${content.trim().replace(/\n/g, "\n\n")}\n\n`,
      });
      turndown.addRule("grokCodeBlock", {
        filter: (node) =>
          node.nodeName === "DIV" &&
          node.getAttribute("data-testid") === "code-block",
        replacement: (content, node) => {
          const rawLang =
            node
              .querySelector(".font-mono.text-xs")
              ?.textContent.trim()
              .toLowerCase() || "";
          const lang = rawLang === "text" ? "" : rawLang;
          let codeText = content;
          const existingFence = content.match(/```[\w]*\n([\s\S]*?)\n```/);
          if (existingFence)
            return `\n\`\`\`${lang}\n${existingFence[1].trim()}\n\`\`\`\n\n`;
          if (node.querySelector(".font-mono.text-xs")) {
            const lbl = node
              .querySelector(".font-mono.text-xs")
              .textContent.trim();
            if (codeText.startsWith(lbl)) codeText = codeText.slice(lbl.length);
          }
          codeText = codeText.replace(/^(Collapse|Run|Copy|Wrap)+/, "").trim();
          return codeText ? `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n` : "";
        },
      });
    },
  };

  /**
   * Resolves the active platform adapter from window.location, or null if
   * unsupported.
   */
  Platforms.detectCurrent = function detectCurrent() {
    const hostname = window.location.hostname;
    return (
      Object.values(Platforms.registry).find((p) =>
        p.hostnames.some((h) => hostname.includes(h)),
      ) || null
    );
  };

  /* ==========================================================================
   * 7b. HISTORY — the whole conversation from the site's own backend.
   *
   * The page only holds what is rendered (Gemini lazy-loads older turns,
   * others virtualise long chats), so an old chat looks short from the DOM.
   * These adapters ask the site for the full thread, the same way it loads
   * it itself: same-origin, with the session the page already has. Shapes
   * follow the open-source exporters that read these endpoints
   * (pionxzh/chatgpt-exporter, agoramachina/claude-exporter,
   * pinguarmy/ai-chat-exporter, llg1634/grok-full-exporter).
   *
   *   conversationId()      -> string  — "" on a new or unsaved chat
   *   fetchHistory(id)      -> { items, model?, uncounted? }
   *     items: [{ role: "user"|"ai", kind, text }] in order, current branch
   *     only. kind is "message", or "instructions" / "memory" / "tool" /
   *     "attachment" for context the model reads but the page hides.
   *     uncounted: images and files whose tokens cannot be known here.
   *   fetchUsage()          -> [{ label, percent, resetsAt }] (optional)
   * ========================================================================== */
  const History = {
    async getJson(url, options = {}) {
      const res = await fetch(url, {
        credentials: "include",
        ...options,
        headers: { accept: "application/json", ...(options.headers || {}) },
      });
      if (!res.ok) throw new Error(`${new URL(url, location.href).pathname} → HTTP ${res.status}`);
      return res.json();
    },

    cookie(name) {
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : "";
    },

    /** Oldest-first path from a leaf up to the root through parent links. */
    walkBranch(byId, leafId, parentOf) {
      const branch = [];
      const seen = new Set();
      for (let id = leafId; id && byId.has(id) && !seen.has(id); id = parentOf(byId.get(id))) {
        seen.add(id);
        branch.unshift(byId.get(id));
      }
      return branch;
    },
  };

  /* ---- ChatGPT: /backend-api/conversation/{id}, bearer from /api/auth/session */
  Object.assign(Platforms.registry.chatgpt, {
    _auth: null,

    conversationId() {
      const m = location.pathname.match(/^\/(?:c|g\/[a-z0-9-]+\/c)\/([a-z0-9-]+)/i);
      return m ? m[1] : "";
    },

    async authHeaders() {
      const self = Platforms.registry.chatgpt;
      if (!self._auth || Date.now() - self._auth.at > 10 * 60 * 1000) {
        const session = await History.getJson("/api/auth/session");
        if (!session?.accessToken) throw new Error("not signed in");
        const headers = { authorization: `Bearer ${session.accessToken}` };
        // Team workspaces answer only with the workspace's account id.
        const workspace = History.cookie("_account");
        if (workspace) {
          try {
            const check = await History.getJson("/backend-api/accounts/check/v4-2023-04-27", { headers });
            const accountId = check?.accounts?.[workspace]?.account?.account_id;
            if (accountId) headers["chatgpt-account-id"] = accountId;
          } catch (e) {
            /* personal account — no header needed */
          }
        }
        self._auth = { at: Date.now(), headers };
      }
      return self._auth.headers;
    },

    async fetchHistory(id) {
      const self = Platforms.registry.chatgpt;
      const data = await History.getJson(`/backend-api/conversation/${id}`, {
        headers: await self.authHeaders(),
      });
      const byId = new Map(Object.entries(data.mapping || {}));
      const leaf =
        data.current_node ||
        [...byId.values()].find((n) => !n.children || !n.children.length)?.id;
      const branch = History.walkBranch(byId, leaf, (n) => n.parent);

      const items = [];
      let uncounted = 0;
      let model = "";
      branch.forEach(({ message: msg }) => {
        if (!msg || !msg.content) return;
        const c = msg.content;
        const role = msg.author?.role;
        if (msg.metadata?.model_slug) model = msg.metadata.model_slug;
        // Reasoning is not carried into later turns.
        if (c.content_type === "thoughts" || c.content_type === "reasoning_recap") return;
        let text = "";
        let kind = "message";
        switch (c.content_type) {
          case "text":
          case "multimodal_text":
            (c.parts || []).forEach((p) => {
              if (typeof p === "string") text += (text ? "\n" : "") + p;
              else if (p && typeof p === "object") uncounted++;
            });
            break;
          case "code":
          case "execution_output":
          case "tether_quote":
            text = c.text || "";
            break;
          case "tether_browsing_display":
            text = c.result || "";
            break;
          case "user_editable_context":
            text = [c.user_profile, c.user_instructions].filter(Boolean).join("\n");
            kind = "instructions";
            break;
          case "model_editable_context":
            text = c.model_set_context || "";
            kind = "memory";
            break;
          default:
            text = typeof c.text === "string" ? c.text : "";
        }
        if (!text.trim()) return;
        if (kind === "message" && (role === "tool" || role === "system" || msg.recipient !== "all")) kind = "tool";
        if (kind === "message" && msg.metadata?.is_visually_hidden_from_conversation) kind = "instructions";
        items.push({ role: role === "user" ? "user" : "ai", kind, text });
      });
      return { items, model, uncounted };
    },
  });

  /* ---- Claude: /api/organizations/{org}/chat_conversations/{id}?tree=True */
  Object.assign(Platforms.registry.claude, {
    _orgId: "",

    conversationId() {
      const m = location.pathname.match(/\/chat\/([a-f0-9-]{36})/i);
      return m ? m[1] : "";
    },

    async orgId() {
      const self = Platforms.registry.claude;
      if (self._orgId) return self._orgId;
      const orgs = await History.getJson("/api/organizations");
      const active = History.cookie("lastActiveOrg");
      const org =
        orgs.find((o) => o.uuid === active) ||
        orgs.find((o) => (o.capabilities || []).includes("chat")) ||
        orgs[0];
      if (!org) throw new Error("no organization");
      self._orgId = org.uuid;
      return self._orgId;
    },

    async fetchHistory(id) {
      const org = await Platforms.registry.claude.orgId();
      const data = await History.getJson(
        `/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`,
      );
      const messages = data.chat_messages || [];
      const byId = new Map(messages.map((m) => [m.uuid, m]));
      const branch = data.current_leaf_message_uuid
        ? History.walkBranch(byId, data.current_leaf_message_uuid, (m) => m.parent_message_uuid)
        : messages;

      const items = [];
      let uncounted = 0;
      branch.forEach((msg) => {
        const role = msg.sender === "human" ? "user" : "ai";
        (msg.attachments || []).forEach((a) => {
          if (a.extracted_content)
            items.push({ role: "user", kind: "attachment", text: a.extracted_content });
        });
        uncounted += (msg.files_v2 || msg.files || []).length;
        const blocks = Array.isArray(msg.content) && msg.content.length
          ? msg.content
          : [{ type: "text", text: msg.text || "" }];
        let text = "";
        blocks.forEach((b) => {
          if (b.type === "text" && b.text) text += (text ? "\n\n" : "") + b.text;
          else if (b.type === "tool_use") {
            items.push({ role: "ai", kind: "tool", text: JSON.stringify(b.input || {}) });
          } else if (b.type === "tool_result") {
            const out = Array.isArray(b.content)
              ? b.content.map((x) => x.text || "").join("\n")
              : typeof b.content === "string" ? b.content : "";
            if (out) items.push({ role: "user", kind: "tool", text: out });
          }
          // Thinking is dropped from later turns, so it is not counted.
        });
        if (text.trim()) items.push({ role, kind: "message", text });
      });
      return { items, model: data.model || "", uncounted };
    },

    /**
     * claude.ai's own plan usage: GET /api/organizations/{org}/usage. Newer
     * builds send limits[] {kind, percent, resets_at}; older ones five_hour /
     * seven_day {utilization, resets_at}. Quota, not context — shown as-is.
     */
    async fetchUsage() {
      const org = await Platforms.registry.claude.orgId();
      const data = await History.getJson(`/api/organizations/${org}/usage`);
      const names = { session: "5-hour session", weekly_all: "Weekly", weekly_scoped: "Weekly (model)" };
      if (Array.isArray(data?.limits) && data.limits.length)
        return data.limits
          .filter((l) => typeof l.percent === "number")
          .map((l) => ({
            label: (names[l.kind] || l.kind) +
              (l.scope?.model?.display_name ? ` — ${l.scope.model.display_name}` : ""),
            percent: l.percent,
            resetsAt: l.resets_at || "",
          }));
      return [
        ["five_hour", "5-hour session"], ["seven_day", "Weekly"],
        ["seven_day_opus", "Weekly — Opus"], ["seven_day_sonnet", "Weekly — Sonnet"],
      ]
        .filter(([key]) => data?.[key] && typeof data[key].utilization === "number")
        .map(([key, label]) => ({
          label,
          // Seen both as 0-1 and as 0-100.
          percent: data[key].utilization <= 1 ? data[key].utilization * 100 : data[key].utilization,
          resetsAt: data[key].resets_at || "",
        }));
    },
  });

  /* ---- Grok: /rest/app-chat/conversations/{id}/response-node + load-responses.
   * Field names are less settled than the others, so several spellings are
   * accepted, and an empty result falls back to the page. */
  Object.assign(Platforms.registry.grok, {
    conversationId() {
      const m = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
      return m ? m[1] : "";
    },

    async fetchHistory(id) {
      const base = `/rest/app-chat/conversations/${id}`;
      const tree = await History.getJson(`${base}/response-node?includeThreads=true`);
      const nodes = tree.responseNodes || tree.response_nodes || [];
      const idOf = (n) => n.responseId || n.id;
      const parentOf = (n) => n.parentResponseId || n.parent_response_id || "";
      // Follow the branch from the newest node when parent links exist.
      let chain = nodes;
      if (nodes.some(parentOf)) {
        const byId = new Map(nodes.map((n) => [idOf(n), n]));
        chain = History.walkBranch(byId, idOf(nodes[nodes.length - 1]), parentOf);
      }
      const ids = chain.map(idOf).filter(Boolean);
      const responses = [];
      for (let i = 0; i < ids.length; i += 100) {
        const page = await History.getJson(`${base}/load-responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ responseIds: ids.slice(i, i + 100) }),
        });
        responses.push(...(page.responses || []));
      }
      const order = new Map(ids.map((rid, i) => [rid, i]));
      responses.sort((a, b) => (order.get(idOf(a)) ?? 0) - (order.get(idOf(b)) ?? 0));
      const items = responses
        .map((r) => ({
          role: /user|human/i.test(r.sender || r.role || "") ? "user" : "ai",
          kind: "message",
          text: String(r.message ?? r.content ?? r.text ?? ""),
        }))
        .filter((i) => i.text.trim());
      return { items, uncounted: 0 };
    },
  });

  /* ---- Gemini: batchexecute rpc hNvQHb (the call the app uses to open a
   * chat). The at / f.sid tokens come from the page's WIZ_global_data. */
  Object.assign(Platforms.registry.gemini, {
    conversationId() {
      const m = location.pathname.match(/\/app\/([a-z0-9_-]+)/i);
      return m ? m[1].replace(/^c_/, "") : "";
    },

    wizValue(key) {
      const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`);
      for (const script of document.scripts) {
        const m = script.textContent.match(re);
        if (m) return m[1];
      }
      return "";
    },

    async fetchHistory(id) {
      const self = Platforms.registry.gemini;
      const at = self.wizValue("SNlM0e");
      if (!at) throw new Error("session token not found on the page");
      const prefix = (location.pathname.match(/^\/u\/\d+/) || [""])[0];
      const params = new URLSearchParams({
        rpcids: "hNvQHb",
        "source-path": location.pathname,
        "f.sid": self.wizValue("FdrFJe"),
        _reqid: String(Math.floor(Math.random() * 100000)),
        rt: "c",
      });
      const bl = self.wizValue("cfb2h");
      if (bl) params.set("bl", bl);
      const body = new URLSearchParams({
        "f.req": JSON.stringify([[["hNvQHb", JSON.stringify([`c_${id}`, 1000, null, 1, [1], [4], null, 1]), null, "generic"]]]),
        at,
      });
      const res = await fetch(`${prefix}/_/BardChatUi/data/batchexecute?${params}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "x-same-domain": "1",
        },
        body,
      });
      if (!res.ok) throw new Error(`batchexecute → HTTP ${res.status}`);
      let payload = null;
      for (const line of (await res.text()).split("\n")) {
        const start = line.indexOf("[[");
        if (start === -1) continue;
        try {
          for (const entry of JSON.parse(line.slice(start)))
            if (entry?.[0] === "wrb.fr" && entry[1] === "hNvQHb" && typeof entry[2] === "string")
              payload = JSON.parse(entry[2]);
        } catch (e) {
          /* not the JSON line */
        }
        if (payload) break;
      }
      const turns = payload?.[0];
      if (!Array.isArray(turns)) throw new Error("unexpected batchexecute reply");
      const items = [];
      // Newest first on the wire.
      [...turns].reverse().forEach((turn) => {
        const user = turn?.[2]?.[0]?.[0];
        const reply = turn?.[3]?.[0]?.[0]?.[1]?.[0];
        if (typeof user === "string" && user.trim()) items.push({ role: "user", kind: "message", text: user });
        if (typeof reply === "string" && reply.trim()) items.push({ role: "ai", kind: "message", text: reply });
      });
      return { items, uncounted: 0 };
    },
  });

  /* ==========================================================================
   * 8. PROMPT STORE — the prompt library and its GitHub Gist sync.
   *
   * Local-first: every prompt lives in GM storage and works offline. A single
   * secret gist is an optional mirror so the same library follows you across
   * browsers and machines.
   *
   * A prompt is { id, title, body, createdAt, updatedAt, deleted? }.
   * Skills live in the same list as { ..., kind: "skill", description }, so
   * they share the gist and its merge; a record with no kind is a prompt.
   * Deletes leave a tombstone (deleted: true) rather than dropping the record,
   * otherwise a pull from an out-of-date gist would resurrect it. Merging is
   * last-write-wins per id, compared on updatedAt.
   * ========================================================================== */
  const PromptStore = {
    _prompts: null,
    _listeners: new Set(),

    /** Lazily reads GM storage. Tolerates both array and JSON-string values. */
    load() {
      if (PromptStore._prompts) return PromptStore._prompts;
      const raw = Store.get(Config.GM_KEYS.PROMPTS, "[]");
      let parsed = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw || "[]");
        } catch (e) {
          parsed = [];
        }
      }
      PromptStore._prompts = Array.isArray(parsed) ? parsed : [];
      return PromptStore._prompts;
    },

    /** Live records of one kind (tombstones filtered out), sorted by title. */
    list(kind = "prompt") {
      return PromptStore.load()
        .filter((p) => p && !p.deleted && p.title && (p.kind || "prompt") === kind)
        .sort((a, b) =>
          String(a.title).localeCompare(String(b.title), undefined, {
            sensitivity: "base",
          }),
        );
    },

    get(id) {
      return PromptStore.load().find((p) => p.id === id) || null;
    },

    persist() {
      Store.set(Config.GM_KEYS.PROMPTS, JSON.stringify(PromptStore.load()));
      PromptStore._listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          /* a broken listener must not break the save */
        }
      });
    },

    /** @returns {() => void} an unsubscribe function. */
    subscribe(fn) {
      PromptStore._listeners.add(fn);
      return () => PromptStore._listeners.delete(fn);
    },

    /** @param {Object} [extra] e.g. { kind: "skill", description } */
    add(title, body, extra = {}) {
      const now = new Date().toISOString();
      const prompt = {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title:
          String(title || "").trim() ||
          (extra.kind === "skill" ? "Untitled skill" : "Untitled prompt"),
        body: String(body || ""),
        ...extra,
        createdAt: now,
        updatedAt: now,
      };
      PromptStore.load().push(prompt);
      PromptStore.persist();
      return prompt;
    },

    update(id, patch) {
      const prompt = PromptStore.get(id);
      if (!prompt) return null;
      Object.assign(prompt, patch, { updatedAt: new Date().toISOString() });
      PromptStore.persist();
      return prompt;
    },

    remove(id) {
      const prompt = PromptStore.get(id);
      if (!prompt) return false;
      prompt.deleted = true;
      prompt.body = "";
      if (prompt.description) prompt.description = "";
      prompt.updatedAt = new Date().toISOString();
      PromptStore.persist();
      return true;
    },

    /**
     * Last-write-wins merge of two prompt arrays, keyed by id.
     * @returns {{merged: Object[], added: number, updated: number}}
     */
    mergeLists(localList, remoteList) {
      const byId = new Map();
      localList.forEach((p) => p && p.id && byId.set(p.id, p));
      let added = 0;
      let updated = 0;
      (remoteList || []).forEach((remote) => {
        if (!remote || !remote.id) return;
        const local = byId.get(remote.id);
        if (!local) {
          byId.set(remote.id, remote);
          if (!remote.deleted) added++;
          return;
        }
        const remoteTime = Date.parse(remote.updatedAt || 0) || 0;
        const localTime = Date.parse(local.updatedAt || 0) || 0;
        if (remoteTime > localTime) {
          byId.set(remote.id, remote);
          updated++;
        }
      });
      return { merged: [...byId.values()], added, updated };
    },

    /* ---------------- GitHub Gist sync ---------------- */
    gist: {
      config() {
        return {
          token: String(Store.get(Config.GM_KEYS.GIST_TOKEN, "") || "").trim(),
          id: String(Store.get(Config.GM_KEYS.GIST_ID, "") || "").trim(),
        };
      },

      setConfig(token, id) {
        Store.set(Config.GM_KEYS.GIST_TOKEN, String(token || "").trim());
        Store.set(Config.GM_KEYS.GIST_ID, String(id || "").trim());
      },

      lastSync() {
        return Store.get(Config.GM_KEYS.GIST_LAST_SYNC, "") || "";
      },

      headers(token) {
        return {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        };
      },

      /** Browser URL of the gist; gist.github.com/<id> redirects to the owner's page. */
      webUrl(id) {
        return `${Config.GIST.WEB}/${encodeURIComponent(id)}`;
      },

      // Set by fetchRemote when the gist still carries the old filename.
      _hasLegacyFile: false,

      /** The gist's single file, as { version, prompts }. */
      filePayload(prompts, { dropLegacy = false } = {}) {
        return {
          files: {
            // null deletes a gist file; only sent when it is known to exist.
            ...(dropLegacy ? { [Config.GIST.LEGACY_FILENAME]: null } : {}),
            [Config.GIST.FILENAME]: {
              content: JSON.stringify(
                {
                  version: Config.GIST.SCHEMA_VERSION,
                  updatedAt: new Date().toISOString(),
                  prompts,
                },
                null,
                2,
              ),
            },
          },
        };
      },

      /** Creates a new secret gist and remembers its id. */
      async create() {
        const { token } = PromptStore.gist.config();
        if (!token) throw new Error("Add a GitHub token with 'gist' scope first.");
        const res = await Net.json({
          method: "POST",
          url: `${Config.GIST.API}/gists`,
          headers: PromptStore.gist.headers(token),
          body: JSON.stringify({
            description: Config.GIST.DESCRIPTION,
            public: false,
            ...PromptStore.gist.filePayload(PromptStore.load()),
          }),
        });
        Store.set(Config.GM_KEYS.GIST_ID, res.id);
        Store.set(Config.GM_KEYS.GIST_LAST_SYNC, new Date().toISOString());
        return res.id;
      },

      /** Fetches the remote prompt array. Missing file => empty library. */
      async fetchRemote() {
        const { token, id } = PromptStore.gist.config();
        if (!token || !id)
          throw new Error("Set a GitHub token and gist id first.");
        const res = await Net.json({
          method: "GET",
          // Bust GitHub's edge cache so a push from another machine is visible.
          url: `${Config.GIST.API}/gists/${id}?t=${Date.now()}`,
          headers: PromptStore.gist.headers(token),
        });
        const files = res.files || {};
        PromptStore.gist._hasLegacyFile = !!files[Config.GIST.LEGACY_FILENAME];
        const file = files[Config.GIST.FILENAME] || files[Config.GIST.LEGACY_FILENAME];
        if (!file) return [];
        if (file.truncated && file.raw_url) {
          const raw = await Net.request({ method: "GET", url: file.raw_url });
          return PromptStore.gist.parseFile(raw.text);
        }
        return PromptStore.gist.parseFile(file.content);
      },

      parseFile(text) {
        if (!text) return [];
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error("The gist file is not valid JSON.");
        }
        if (Array.isArray(data)) return data;
        return Array.isArray(data.prompts) ? data.prompts : [];
      },

      async pushRemote(prompts) {
        const { token, id } = PromptStore.gist.config();
        await Net.json({
          method: "PATCH",
          url: `${Config.GIST.API}/gists/${id}`,
          headers: PromptStore.gist.headers(token),
          body: JSON.stringify(
            PromptStore.gist.filePayload(prompts, {
              dropLegacy: PromptStore.gist._hasLegacyFile,
            }),
          ),
        });
        PromptStore.gist._hasLegacyFile = false;
      },

      /**
       * Pull, merge, push back. Safe to run from several machines because the
       * merge is per-prompt rather than whole-file.
       * @returns {Promise<{added:number, updated:number, total:number}>}
       */
      async sync() {
        const remote = await PromptStore.gist.fetchRemote();
        const { merged, added, updated } = PromptStore.mergeLists(
          PromptStore.load(),
          remote,
        );
        PromptStore._prompts = merged;
        PromptStore.persist();
        await PromptStore.gist.pushRemote(merged);
        Store.set(Config.GM_KEYS.GIST_LAST_SYNC, new Date().toISOString());
        return {
          added,
          updated,
          total: merged.filter((p) => !p.deleted).length,
        };
      },
    },
  };

  /* ==========================================================================
   * 8b. SKILLS — reusable instruction sets, stored in PromptStore (kind
   * "skill"), that one click brings into the chat: as a <skill> block typed
   * into the input box, or as a SKILL.md-style file attached to the message.
   * ========================================================================== */
  const Skills = {
    mode() {
      return Store.get(Config.GM_KEYS.SKILL_IMPORT_MODE, "text") === "file" ? "file" : "text";
    },

    setMode(mode) {
      Store.set(Config.GM_KEYS.SKILL_IMPORT_MODE, mode === "file" ? "file" : "text");
    },

    slug(title) {
      return (
        String(title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64) || "skill"
      );
    },

    /** The block typed into the input box. */
    toText(skill) {
      const name = String(skill.title).replace(/"/g, "'");
      const desc = String(skill.description || "").trim();
      return (
        `<skill name="${name}">\n` +
        (desc ? `Use when: ${desc}\n\n` : "") +
        `${String(skill.body).trim()}\n</skill>\n`
      );
    },

    /** SKILL.md layout: YAML front matter (name, description), then the body. */
    toMarkdown(skill) {
      const desc = String(skill.description || "").replace(/\s+/g, " ").trim();
      return (
        `---\nname: ${Skills.slug(skill.title)}\n` +
        (desc ? `description: ${JSON.stringify(desc)}\n` : "") +
        `---\n\n${String(skill.body).trim()}\n`
      );
    },

    /**
     * Reads a SKILL.md (or any text file). Front matter is optional.
     * @returns {{title: string, description: string, body: string}}
     */
    parse(text, fallbackName = "") {
      const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
      const meta = {};
      let body = src;
      const fm = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
      if (fm) {
        body = src.slice(fm[0].length);
        fm[1].split("\n").forEach((line) => {
          const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
          if (!m) return;
          let value = m[2].trim();
          if (/^".*"$/.test(value)) {
            try {
              value = JSON.parse(value);
            } catch (e) {
              value = value.slice(1, -1);
            }
          } else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
          meta[m[1].toLowerCase()] = value;
        });
      }
      return {
        title: String(meta.name || fallbackName || "").trim(),
        description: String(meta.description || "").trim(),
        body: body.trim(),
      };
    },

    /**
     * Brings a skill into the chat in the chosen mode. A file the site will
     * not take falls back to text, and no input box at all to the clipboard.
     * @returns {{ok: boolean, message: string}}
     */
    importToChat(skill) {
      const name = Utils.truncate(skill.title, 40);
      if (Skills.mode() === "file") {
        const file = new File([Skills.toMarkdown(skill)], `${Skills.slug(skill.title)}.md`, {
          type: "text/markdown",
        });
        if (Composer.attachFiles([file]))
          return { ok: true, message: `Attached skill "${name}" as ${file.name}` };
      }
      const text = Skills.toText(skill);
      if (Composer.insert(text))
        return { ok: true, message: `Added skill "${name}" to the input box` };
      navigator.clipboard.writeText(text).catch(() => {});
      return { ok: false, message: "No input box found — skill copied to clipboard" };
    },
  };

  /* ==========================================================================
   * 9. COMPOSER — locating the host site's input box and typing into it.
   *
   * Every site uses a different editor (plain <textarea>, ProseMirror, Quill),
   * and all of them are React/Angular-controlled, so assigning .value or
   * .textContent directly is silently discarded on the next re-render. The two
   * insertion paths below both go through the events those frameworks listen
   * for, which is why they survive.
   * ========================================================================== */
  const Composer = {
    // Tried after the active platform's own selectors, so an unrecognised
    // layout (or a site redesign) still usually works.
    FALLBACK_SELECTORS: [
      "form div[contenteditable='true']",
      "div[contenteditable='true']",
      "form textarea",
      "main textarea",
      "textarea",
    ],

    isUsable(el) {
      if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 12) return false;
      const style = window.getComputedStyle(el);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.opacity !== "0"
      );
    },

    /** @returns {HTMLElement|null} the visible composer, or null. */
    find() {
      const selectors = [
        ...(UI._platform && UI._platform.composerSelectors
          ? UI._platform.composerSelectors
          : []),
        ...Composer.FALLBACK_SELECTORS,
      ];
      for (const selector of selectors) {
        let matches;
        try {
          matches = [...document.querySelectorAll(selector)];
        } catch (e) {
          continue; // A selector that this browser cannot parse — skip it.
        }
        // Walk backwards: the composer is virtually always the last match,
        // since earlier ones tend to be the rendered messages above it.
        for (let i = matches.length - 1; i >= 0; i--) {
          if (Composer.isUsable(matches[i])) return matches[i];
        }
      }
      return null;
    },

    /**
     * The visible card around the editor — the rounded box that also holds
     * attachments, the model picker and the send button. Anchoring to the bare
     * editor puts anything glued to its top edge in the middle of the card as
     * soon as a file chip is added above the text.
     * @returns {HTMLElement} the outermost card-like ancestor, or the editor.
     */
    frameOf(editor) {
      const base = editor.getBoundingClientRect();
      const maxHeight = window.innerHeight * 0.6;
      let frame = editor;
      let el = editor.parentElement;
      for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
        if (el === document.body || el === document.documentElement) break;
        const rect = el.getBoundingClientRect();
        // Past this we are into page layout, not the composer.
        if (rect.height > maxHeight || rect.width > base.width + 400) break;
        const style = window.getComputedStyle(el);
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        const painted =
          style.boxShadow !== "none" ||
          parseFloat(style.borderTopWidth) > 0 ||
          !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor);
        if (radius >= 8 && painted) frame = el;
      }
      if (frame === editor) frame = editor.closest("form, fieldset") || editor;
      return frame;
    },

    /** Puts the caret at the end of a contenteditable so insertText lands there. */
    caretToEnd(el) {
      const selection = window.getSelection();
      if (!selection) return;
      if (selection.rangeCount && el.contains(selection.anchorNode)) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },

    insertIntoTextarea(el, text) {
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      // React installs its own value setter on the element instance; going
      // through the prototype setter is what makes React see the change.
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      const start = el.selectionStart == null ? el.value.length : el.selectionStart;
      const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
      setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const caret = start + text.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch (e) {
        /* some inputs disallow selection APIs */
      }
    },

    insertIntoEditable(el, text) {
      Composer.caretToEnd(el);
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch (e) {
        inserted = false;
      }
      if (inserted) return;
      // execCommand is deprecated and already a no-op in some builds; a
      // synthetic paste is what ProseMirror and Quill handle next-best.
      try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      } catch (e) {
        el.textContent = (el.textContent || "") + text;
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: text,
          inputType: "insertText",
        }),
      );
    },

    /**
     * Inserts text at the caret of the site's composer.
     * @returns {boolean} false when no composer could be found.
     */
    insert(text) {
      const el = Composer.find();
      if (!el) return false;
      el.focus();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT")
        Composer.insertIntoTextarea(el, text);
      else Composer.insertIntoEditable(el, text);
      el.focus();
      return true;
    },

    isField(el) {
      return el.tagName === "TEXTAREA" || el.tagName === "INPUT";
    },

    /**
     * The composer's current text, or null when there is no composer.
     * Rich editors keep one block element per line, and innerText pads each
     * <p> with a blank line, so their children are joined one per line.
     */
    getText(el = Composer.find()) {
      if (!el) return null;
      if (Composer.isField(el)) return el.value;
      const blocks = [...el.children];
      const text = (
        blocks.length
          ? blocks.map((b) => b.innerText.replace(/\n$/, "")).join("\n")
          : el.innerText
      ).replace(/ /g, " "); // editors keep runs of spaces as &nbsp;
      return text.trim() ? text : "";
    },

    /**
     * Replaces everything in the composer. Goes through the same framework-
     * visible paths as insert(), with the whole content selected first, so
     * the site's undo (Ctrl+Z) still brings the old text back.
     * @returns {boolean} false when no composer could be found.
     */
    setText(text) {
      const el = Composer.find();
      if (!el) return false;
      el.focus();
      if (Composer.isField(el)) {
        el.setSelectionRange?.(0, el.value.length);
        Composer.insertIntoTextarea(el, text);
        return true;
      }
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      if (text) {
        Composer.insertIntoEditable(el, text);
      } else {
        document.execCommand("delete");
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "deleteContent" }),
        );
      }
      return true;
    },

    /**
     * Attaches files to the message being written: first as a paste (which
     * every one of these sites accepts for images), then through the
     * composer's own file <input> if nobody handled the paste.
     * @returns {boolean} whether some handler took the files.
     */
    attachFiles(files) {
      const el = Composer.find();
      if (!el || !files.length) return false;
      const transfer = () => {
        const data = new DataTransfer();
        files.forEach((f) => data.items.add(f));
        return data;
      };
      el.focus();
      try {
        const paste = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer(),
        });
        el.dispatchEvent(paste);
        if (paste.defaultPrevented) return true;
      } catch (e) {
        /* no ClipboardEvent constructor — try the file input */
      }
      const frame = Composer.frameOf(el);
      const input =
        frame.querySelector("input[type='file']") ||
        el.closest("form")?.querySelector("input[type='file']") ||
        document.querySelector("input[type='file']");
      if (!input) return false;
      input.files = transfer().files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
  };

  /* ==========================================================================
   * 9b. TOKENIZERS — the real token count for each site, not a guess.
   *
   * No chat site reports context usage to its own web page (claude.ai even
   * strips `usage` from its stream), so the count has to be made here, and
   * each site gets the most exact method that exists for its models:
   *
   *   ChatGPT, Copilot  o200k_base, OpenAI's published BPE for GPT-4o/4.1/5
   *                     and the o-series (tiktoken/model.py). Runs locally
   *                     and is exact; the ranks file is fetched once.
   *   Claude            Anthropic's POST /v1/messages/count_tokens. There is
   *                     no public tokenizer for current Claude models, and
   *                     OpenAI's undercounts Claude by 15-20%.
   *   Gemini            Google's models/{model}:countTokens. No local one.
   *   Grok              xAI's POST /v1/tokenize-text.
   *
   * The three APIs need the user's own key and are free to call. Without a
   * key those sites fall back to an estimate, and the meter says so.
   * ========================================================================== */
  const Tokenizers = {
    /** Which method each site uses. */
    METHODS: {
      chatgpt: { kind: "o200k" },
      copilot: { kind: "o200k" },
      claude: { kind: "api", provider: "anthropic" },
      gemini: { kind: "api", provider: "gemini" },
      grok: { kind: "api", provider: "xai" },
    },

    PROVIDERS: {
      anthropic: {
        name: "Anthropic count_tokens API",
        keyLabel: "Anthropic API key (console.anthropic.com)",
        keyHint: "sk-ant-…",
        defaultModel: "claude-opus-5",
      },
      gemini: {
        name: "Gemini countTokens API",
        keyLabel: "Gemini API key (aistudio.google.com)",
        keyHint: "AIza…",
        defaultModel: "gemini-3.8-flash",
      },
      xai: {
        name: "xAI tokenize-text API",
        keyLabel: "xAI API key (console.x.ai)",
        keyHint: "xai-…",
        defaultModel: "grok-4.6",
      },
    },

    settings() {
      return Store.get(Config.GM_KEYS.METER_TOKENIZER, {}) || {};
    },

    /** Saves { key, model } for one provider; empty strings clear them. */
    configure(provider, { key, model }) {
      const all = { ...Tokenizers.settings() };
      all[provider] = { key: (key || "").trim(), model: (model || "").trim() };
      Store.set(Config.GM_KEYS.METER_TOKENIZER, all);
    },

    /** @returns {{kind, provider?, key?, model?, label}} the method for a site. */
    methodFor(platformId, siteModel) {
      const method = Tokenizers.METHODS[platformId] || { kind: "estimate" };
      if (method.kind === "o200k")
        return { ...method, label: "o200k_base — OpenAI tokenizer, exact" };
      if (method.kind !== "api") return { kind: "estimate", label: "estimate (~4 chars/token)" };
      const provider = Tokenizers.PROVIDERS[method.provider];
      const saved = Tokenizers.settings()[method.provider] || {};
      return {
        ...method,
        key: saved.key || "",
        // A model the user typed wins, then the one the chat says it uses.
        model: saved.model || siteModel || provider.defaultModel,
        label: saved.key
          ? `${provider.name}, exact`
          : `estimate — add a key below for ${provider.name}`,
      };
    },

    /* ---------------- o200k_base, local BPE ----------------
     * A port of tiktoken's encoder that only counts. Checked token-for-token
     * against js-tiktoken on code, prose, CJK, emoji and long runs. */
    o200k: {
      _ranks: null,
      _pattern: null,
      _loading: null,
      _cache: new Map(),
      _encoder: new TextEncoder(),

      ready() {
        return !!Tokenizers.o200k._ranks;
      },

      /** Loads the ranks once per page; the file itself is cached in storage. */
      load() {
        const t = Tokenizers.o200k;
        if (t._ranks) return Promise.resolve();
        if (!t._loading)
          t._loading = t._load().catch((e) => {
            t._loading = null;
            throw e;
          });
        return t._loading;
      },

      async _load() {
        const t = Tokenizers.o200k;
        let source = Store.get(Config.GM_KEYS.O200K_CACHE, "");
        const fresh = !source;
        if (fresh) {
          const res = await Net.request({ url: Config.METER.O200K_URL });
          if (res.status !== 200) throw new Error(`HTTP ${res.status} loading o200k_base`);
          source = res.text;
        }
        // js-tiktoken's ranks module: `export default {pat_str, bpe_ranks, …}`.
        let data;
        try {
          data = JSON.parse(source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1));
        } catch (e) {
          Store.set(Config.GM_KEYS.O200K_CACHE, "");
          throw new Error("o200k_base ranks file is corrupt");
        }
        // Each line: "<first token> <offset> <b64 token> <b64 token> …"; the
        // i-th token on a line has rank offset + i. Keys are byte strings.
        const ranks = new Map();
        for (const line of data.bpe_ranks.split("\n")) {
          if (!line) continue;
          const [, offset, ...tokens] = line.split(" ");
          const base = Number(offset);
          tokens.forEach((token, i) => ranks.set(atob(token), base + i));
        }
        if (ranks.size < 199000) throw new Error("o200k_base ranks file is incomplete");
        t._pattern = new RegExp(data.pat_str, "gu");
        t._ranks = ranks;
        if (fresh) {
          try {
            Store.set(Config.GM_KEYS.O200K_CACHE, source);
          } catch (e) {
            /* storage full (bookmarklet localStorage) — refetch next time */
          }
        }
      },

      count(text) {
        const t = Tokenizers.o200k;
        if (!text) return 0;
        const hit = t._cache.get(text);
        if (hit !== undefined) return hit;
        let n = 0;
        for (const match of text.matchAll(t._pattern)) {
          const bytes = t._encoder.encode(match[0]);
          let bin = "";
          for (let s = 0; s < bytes.length; s += 8192)
            bin += String.fromCharCode.apply(null, bytes.subarray(s, s + 8192));
          if (t._ranks.has(bin)) n++;
          else n += bin.length > 64 ? t.mergeCountLarge(bin) : t.mergeCount(bin);
        }
        if (t._cache.size > 4000) t._cache.clear();
        t._cache.set(text, n);
        return n;
      },

      /**
       * tiktoken's _byte_pair_merge: keep merging the adjacent pair whose
       * bytes have the lowest rank (leftmost on ties) until none is a token.
       * @returns {number} how many tokens the piece becomes.
       */
      mergeCount(bin) {
        const ranks = Tokenizers.o200k._ranks;
        if (bin.length === 1) return 1;
        const starts = [];
        for (let i = 0; i <= bin.length; i++) starts.push(i);
        const rankAt = (i) =>
          i + 2 < starts.length
            ? ranks.get(bin.slice(starts[i], starts[i + 2])) ?? Infinity
            : Infinity;
        const r = [];
        for (let i = 0; i < starts.length - 1; i++) r.push(rankAt(i));
        for (;;) {
          let min = Infinity;
          let idx = -1;
          for (let i = 0; i < r.length; i++)
            if (r[i] < min) {
              min = r[i];
              idx = i;
            }
          if (idx < 0) break;
          starts.splice(idx + 1, 1);
          r.splice(idx + 1, 1);
          r[idx] = rankAt(idx);
          if (idx > 0) r[idx - 1] = rankAt(idx - 1);
        }
        return starts.length - 1;
      },

      /** The same merge in O(n log n), for long pieces (runs of spaces, base64). */
      mergeCountLarge(bin) {
        const ranks = Tokenizers.o200k._ranks;
        const n = bin.length;
        const next = new Int32Array(n + 1);
        const prev = new Int32Array(n + 1);
        const version = new Int32Array(n + 1);
        for (let i = 0; i <= n; i++) {
          next[i] = i + 1;
          prev[i] = i - 1;
        }
        const heap = []; // [rank, position, version]
        const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
        const swap = (i, j) => ([heap[i], heap[j]] = [heap[j], heap[i]]);
        const push = (entry) => {
          heap.push(entry);
          for (let i = heap.length - 1; i > 0; ) {
            const p = (i - 1) >> 1;
            if (!less(heap[i], heap[p])) break;
            swap(i, p);
            i = p;
          }
        };
        const pop = () => {
          const top = heap[0];
          const last = heap.pop();
          if (heap.length) {
            heap[0] = last;
            for (let i = 0; ; ) {
              const l = 2 * i + 1;
              let m = i;
              if (l < heap.length && less(heap[l], heap[m])) m = l;
              if (l + 1 < heap.length && less(heap[l + 1], heap[m])) m = l + 1;
              if (m === i) break;
              swap(i, m);
              i = m;
            }
          }
          return top;
        };
        // Re-rank the pair that starts at part i; older heap entries go stale.
        const rerank = (i) => {
          version[i]++;
          if (i < 0 || i >= n || next[i] >= n) return;
          const rank = ranks.get(bin.slice(i, next[next[i]]));
          if (rank !== undefined) push([rank, i, version[i]]);
        };
        for (let i = 0; i < n - 1; i++) rerank(i);
        let parts = n;
        while (heap.length) {
          const [, i, v] = pop();
          if (v !== version[i]) continue;
          const j = next[i];
          next[i] = next[j];
          if (next[j] <= n) prev[next[j]] = i;
          version[j]++;
          parts--;
          rerank(i);
          if (prev[i] >= 0) rerank(prev[i]);
        }
        return parts;
      },
    },

    /* ---------------- provider APIs ---------------- */

    /** Collapses items into alternating user/assistant turns, as chat APIs expect. */
    toTurns(items) {
      const turns = [];
      items.forEach((item) => {
        const role = item.role === "user" ? "user" : "assistant";
        const last = turns[turns.length - 1];
        if (last && last.role === role) last.text += `\n\n${item.text}`;
        else turns.push({ role, text: item.text });
      });
      // Must open with the user, and a trailing assistant turn would be read
      // as a prefill; a one-character user turn fixes both for ~1 token.
      if (!turns.length || turns[0].role !== "user") turns.unshift({ role: "user", text: "." });
      if (turns[turns.length - 1].role !== "user") turns.push({ role: "user", text: "." });
      return turns;
    },

    api: {
      async anthropic(items, model, key) {
        const res = await Net.json({
          method: "POST",
          url: "https://api.anthropic.com/v1/messages/count_tokens",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            // Only matters on the fetch() fallback; GM requests have no CORS.
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model,
            messages: Tokenizers.toTurns(items).map((t) => ({ role: t.role, content: t.text })),
          }),
        });
        return res.input_tokens;
      },

      async gemini(items, model, key) {
        const res = await Net.json({
          method: "POST",
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens`,
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            contents: Tokenizers.toTurns(items).map((t) => ({
              role: t.role === "user" ? "user" : "model",
              parts: [{ text: t.text }],
            })),
          }),
        });
        return res.totalTokens;
      },

      async xai(items, model, key) {
        const res = await Net.json({
          method: "POST",
          url: "https://api.x.ai/v1/tokenize-text",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, text: items.map((i) => i.text).join("\n\n") }),
        });
        return res.token_ids.length;
      },
    },

    _apiCache: new Map(),

    /**
     * Counts every item. o200k and the estimate are per item; an API returns
     * one exact total, which is then shared out over the items in proportion
     * to their estimates (so the breakdown is approximate, the total is not).
     * @returns {Promise<{per:number[], total:number, exact:boolean,
     *   perExact:boolean, label:string, error:string}>}
     */
    async countItems(items, method) {
      const estimates = items.map((i) => Utils.estimateTokens(i.text) + Config.METER.TURN_OVERHEAD);
      const estTotal = estimates.reduce((a, b) => a + b, 0);
      const estimate = (label, error = "") => ({
        per: estimates, total: estTotal, exact: false, perExact: false, label, error,
      });

      if (method.kind === "o200k") {
        try {
          await Tokenizers.o200k.load();
        } catch (e) {
          return estimate("estimate (~4 chars/token)", `o200k_base could not load — ${e.message}`);
        }
        const per = items.map((i) => Tokenizers.o200k.count(i.text) + Config.METER.TURN_OVERHEAD);
        return {
          per, total: per.reduce((a, b) => a + b, 0), exact: true, perExact: true,
          label: method.label, error: "",
        };
      }

      if (method.kind !== "api" || !method.key || !items.length) return estimate(method.label);

      // One request per distinct transcript: nothing is resent until it changes.
      const cacheKey = `${method.provider}|${method.model}|${Utils.hash(items.map((i) => `${i.role}:${i.text}`).join(""))}`;
      let total = Tokenizers._apiCache.get(cacheKey);
      if (total === undefined) {
        try {
          total = await Tokenizers.api[method.provider](items, method.model, method.key);
        } catch (e) {
          return estimate("estimate (~4 chars/token)", `${Tokenizers.PROVIDERS[method.provider].name} failed — ${e.message}`);
        }
        if (Tokenizers._apiCache.size > 50) Tokenizers._apiCache.clear();
        Tokenizers._apiCache.set(cacheKey, total);
      }
      const scale = estTotal ? total / estTotal : 1;
      return {
        per: estimates.map((n) => n * scale), total, exact: true, perExact: false,
        label: method.label, error: "",
      };
    },
  };

  /* ==========================================================================
   * 9c. METER — how full the conversation is, as a traffic light.
   *
   * Counts the whole conversation from its first turn, not just what is on
   * screen: every site lazy-loads or virtualises long chats, so the history is
   * read from the site's own backend (Platform.fetchHistory) and the page is
   * only the fallback. Green: keep going. Yellow: the chat is getting long, be
   * ready to move. Red: start a new chat now.
   * ========================================================================== */
  const Meter = {
    _result: null, // the last full count; see recount()
    _composerTokens: 0,
    _ratio: 1, // exact / estimate from the last API count, for unsent text
    _timer: null,
    _running: false,
    _dirty: false,
    _lastFetchAt: 0,
    _lastConvId: null,
    _usage: null, // the site's own plan-usage numbers, where it has them
    // Keyed, so a rebuilt panel or dock replaces its listener instead of
    // stacking another one onto detached nodes.
    _listeners: new Map(),

    LEVELS: {
      ok: {
        title: "Continue chat",
        detail: "Plenty of room left in this conversation.",
      },
      warn: {
        title: "Get ready to switch",
        detail:
          "The chat is getting long. Finish the current thread of work and " +
          "have a handoff summary ready.",
      },
      crit: {
        title: "Switch now",
        detail:
          "Answers get slower, forgetful and less accurate from here. Ask for " +
          "a handoff summary and continue in a new chat.",
      },
    },

    budget() {
      const id = UI._platform?.id;
      const saved = Store.get(Config.GM_KEYS.METER_BUDGETS, {}) || {};
      return (
        Number(saved[id]) ||
        Config.METER.DEFAULT_BUDGETS[id] ||
        Config.METER.FALLBACK_BUDGET
      );
    },

    /** Saves a budget for the current site; a falsy value restores the default. */
    setBudget(tokens) {
      const id = UI._platform?.id;
      if (!id) return;
      const saved = { ...(Store.get(Config.GM_KEYS.METER_BUDGETS, {}) || {}) };
      if (tokens > 0) saved[id] = Math.round(tokens);
      else delete saved[id];
      Store.set(Config.GM_KEYS.METER_BUDGETS, saved);
      Meter.notify();
    },

    thresholds() {
      const warn = Number(Store.get(Config.GM_KEYS.METER_WARN_PCT, Config.METER.WARN_PCT));
      const crit = Number(Store.get(Config.GM_KEYS.METER_CRIT_PCT, Config.METER.CRIT_PCT));
      return {
        warn: warn > 0 ? warn : Config.METER.WARN_PCT,
        crit: crit > 0 ? crit : Config.METER.CRIT_PCT,
      };
    },

    setThresholds(warn, crit) {
      Store.set(Config.GM_KEYS.METER_WARN_PCT, warn);
      Store.set(Config.GM_KEYS.METER_CRIT_PCT, crit);
      Meter.notify();
    },

    /** Turns the page's extracted messages into countable items. */
    pageItems(chatData) {
      return (chatData?.messages || [])
        .filter((m) => m.contentText)
        .map((m) => ({
          role: m.author === "user" ? "user" : "ai",
          kind: "message",
          text: m.contentText,
        }));
    },

    /**
     * Called whenever the page's chat changes. Opening another chat clears
     * the old count and shows a quick page-only one straight away; the full
     * count follows once the history has been fetched.
     */
    setChat(chatData) {
      const convId = UI._platform?.conversationId?.() || "";
      if (convId !== Meter._lastConvId) {
        Meter._lastConvId = convId;
        Meter._lastFetchAt = 0;
        Meter._result = null;
      }
      if (!Meter._result) {
        const items = Meter.pageItems(chatData);
        const per = items.map((i) => Utils.estimateTokens(i.text) + Config.METER.TURN_OVERHEAD);
        Meter._result = Meter.summarize(items, {
          per, total: per.reduce((a, b) => a + b, 0), exact: false, perExact: false,
          label: "estimate — counting…", error: "",
        }, { source: "page", pending: true });
        Meter.notify();
      }
      Meter.schedule();
    },

    /**
     * Debounced: streaming replies change the page many times a second. The
     * history is refetched at most once per HISTORY_MIN_INTERVAL_MS, but a
     * final recount always lands a few seconds after the page goes quiet.
     */
    schedule(now = false) {
      clearTimeout(Meter._timer);
      const sinceFetch = Date.now() - Meter._lastFetchAt;
      const delay = now
        ? 0
        : Math.max(Config.METER.RECOUNT_DEBOUNCE_MS, Config.METER.HISTORY_MIN_INTERVAL_MS - sinceFetch);
      Meter._timer = setTimeout(() => Meter.recount(), delay);
    },

    async recount() {
      if (Meter._running) {
        Meter._dirty = true;
        return;
      }
      Meter._running = true;
      try {
        const platform = UI._platform;
        const convId = platform?.conversationId?.() || "";
        let items = null;
        let history = null;
        let historyError = "";
        if (convId && typeof platform.fetchHistory === "function") {
          Meter._lastFetchAt = Date.now();
          try {
            history = await platform.fetchHistory(convId);
            items = history.items;
          } catch (e) {
            historyError = e.message;
          }
          if (convId !== (platform.conversationId?.() || "")) return; // navigated away
        }
        const source = items && items.length ? "history" : "page";
        if (source === "page") items = Meter.pageItems(ChatExporter._currentChatData);

        const method = Tokenizers.methodFor(platform?.id, history?.model);
        const counted = await Tokenizers.countItems(items, method);
        const estTotal = items.reduce((s, i) => s + Utils.estimateTokens(i.text) + Config.METER.TURN_OVERHEAD, 0);
        if (counted.exact && estTotal) Meter._ratio = counted.total / estTotal;
        Meter._result = Meter.summarize(items, counted, {
          source,
          historyError,
          model: history?.model || "",
          uncounted: history?.uncounted || 0,
        });
        Meter.tick(true);
        Meter.notify();
        Meter.refreshUsage();
      } catch (e) {
        console.error("AiUtil meter recount failed", e);
      } finally {
        Meter._running = false;
        if (Meter._dirty) {
          Meter._dirty = false;
          Meter.schedule();
        }
      }
    },

    /** Folds per-item counts into the numbers the meter shows. */
    summarize(items, counted, extra) {
      const r = {
        tokens: counted.total, userTokens: 0, aiTokens: 0, contextTokens: 0,
        turns: 0, messages: 0, largest: 0,
        method: counted.label, exact: counted.exact, perExact: counted.perExact,
        error: counted.error, source: "page", historyError: "", model: "",
        uncounted: 0, pending: false, ...extra,
      };
      items.forEach((item, i) => {
        const n = Math.round(counted.per[i]);
        if (item.kind !== "message") r.contextTokens += n;
        else if (item.role === "user") {
          r.userTokens += n;
          r.turns++;
        } else r.aiTokens += n;
        if (item.kind === "message") r.messages++;
        r.largest = Math.max(r.largest, n);
      });
      return r;
    },

    /**
     * Re-reads the unsent composer text. Cheap; called on the Quick Dock poll.
     * Exact under o200k; elsewhere the estimate is scaled by the last exact
     * count so it lands in the same units without an API call per keystroke.
     */
    tick(silent = false) {
      const text = Composer.getText() || "";
      const method = Tokenizers.METHODS[UI._platform?.id]?.kind;
      const tokens =
        method === "o200k" && Tokenizers.o200k.ready()
          ? Tokenizers.o200k.count(text)
          : Math.round(Utils.estimateTokens(text) * Meter._ratio);
      if (tokens === Meter._composerTokens) return;
      Meter._composerTokens = tokens;
      if (!silent) Meter.notify();
    },

    /** The site's own quota numbers (claude.ai only). Never fails loudly. */
    async refreshUsage() {
      const platform = UI._platform;
      if (typeof platform?.fetchUsage !== "function") return;
      if (Meter._usage && Date.now() - Meter._usage.at < Config.METER.USAGE_REFRESH_MS) return;
      try {
        Meter._usage = { at: Date.now(), limits: await platform.fetchUsage() };
      } catch (e) {
        Meter._usage = { at: Date.now(), limits: [], error: e.message };
      }
      Meter.notify();
    },

    snapshot() {
      const chat = Meter._result || Meter.summarize([], {
        per: [], total: 0, exact: false, perExact: false, label: "", error: "",
      }, { pending: true });
      const budget = Meter.budget();
      const { warn, crit } = Meter.thresholds();
      const total = chat.tokens + Meter._composerTokens;
      const pct = (total / budget) * 100;
      const level = pct >= crit ? "crit" : pct >= warn ? "warn" : "ok";
      const perTurn = chat.turns ? chat.tokens / chat.turns : 0;
      const toRed = (budget * crit) / 100 - total;
      return {
        ...chat,
        composerTokens: Meter._composerTokens,
        total,
        budget,
        pct,
        warn,
        crit,
        level,
        perTurn,
        usage: Meter._usage,
        // Only meaningful once there is a turn to average over.
        turnsLeft: perTurn && toRed > 0 ? Math.floor(toRed / perTurn) : null,
      };
    },

    subscribe(key, fn) {
      Meter._listeners.set(key, fn);
      fn(Meter.snapshot());
    },

    notify() {
      const snap = Meter.snapshot();
      Meter._listeners.forEach((fn) => {
        try {
          fn(snap);
        } catch (e) {
          console.error("AiUtil meter listener failed", e);
        }
      });
    },
  };

  /* ==========================================================================
   * 9d. HANDOFF — "new chat with this chat as context".
   *
   * Reads the whole conversation (the same full history the meter uses),
   * packs it in the format chosen in the Floating Dock — plain transcript,
   * TOON, minified text or Snapcompact images — and opens the site's new-chat
   * page with it already in the input box. Nothing is sent: you read it,
   * add your next message and press send yourself.
   *
   * The page load in between wipes this script, so the package travels
   * through GM storage, tagged with an id in the new URL's hash; the fresh
   * page picks it up in consumePending().
   * ========================================================================== */
  const Handoff = {
    FORMATS: {
      transcript: { name: "Transcript", detail: "Plain User / Assistant text" },
      toon: { name: "TOON", detail: "Compact structured text, fewest tokens for long chats" },
      minify: { name: "Minified", detail: "Transcript with all whitespace collapsed" },
      snapcompact: { name: "Snapcompact", detail: "Dense images, attached to the message" },
    },

    // Captured before the site's router can rewrite the URL.
    _hashAtLoad: location.hash,

    settings() {
      return { ...Config.HANDOFF.DEFAULTS, ...(Store.get(Config.GM_KEYS.HANDOFF_SETTINGS, {}) || {}) };
    },

    save(patch) {
      Store.set(Config.GM_KEYS.HANDOFF_SETTINGS, { ...Handoff.settings(), ...patch });
    },

    /** The full conversation, or what the page shows when that fails. */
    async collect() {
      const platform = UI._platform;
      const convId = platform?.conversationId?.() || "";
      if (convId && typeof platform.fetchHistory === "function") {
        try {
          const history = await platform.fetchHistory(convId);
          if (history.items.length) return { items: history.items, source: "history" };
        } catch (e) {
          /* fall through to the page */
        }
      }
      return { items: Meter.pageItems(ChatExporter._currentChatData), source: "page" };
    },

    /** Items the chosen options keep, each with a readable speaker label. */
    select(items, opts) {
      const labels = { attachment: "Attached file", tool: "Tool", instructions: null, memory: null };
      return items
        .filter((i) => {
          if (i.kind === "message") return true;
          if (i.kind === "attachment") return opts.attachments;
          if (i.kind === "tool") return opts.tools;
          return false; // instructions and memory apply in the new chat anyway
        })
        .map((i) => ({
          ...i,
          speaker: i.kind === "message" ? (i.role === "user" ? "User" : "Assistant") : labels[i.kind],
        }));
    },

    /**
     * @returns {Promise<{text:string, files:File[], tokens:number, note:string}>}
     *   the message to prefill, plus images for the Snapcompact format.
     */
    async build(opts) {
      const { items, source } = await Handoff.collect();
      const picked = Handoff.select(items, opts);
      if (!picked.length) throw new Error("There is no conversation here to carry over yet.");
      const title = ChatExporter._currentChatData?.title || document.title || "chat";
      const transcript = picked.map((i) => `${i.speaker}: ${i.text.trim()}`).join("\n\n");
      const wrap = (body) =>
        `${opts.preamble.trim()}\n\n<previous_conversation title="${title.replace(/"/g, "'")}">\n${body}\n</previous_conversation>`;
      const note = source === "history" ? "whole conversation" : "visible page only (history unavailable)";

      if (opts.format === "snapcompact") {
        const text = Snapcompact.serialize(
          picked.map((i) => ({
            author: i.role === "user" ? "user" : "ai",
            contentText: i.kind === "message" ? i.text : `[${i.speaker}] ${i.text}`,
          })),
        );
        const pages = Snapcompact.renderPages(text, { fontSizePx: 10 });
        const blobs = await Promise.all(
          pages.map((p) => new Promise((res) => p.canvas.toBlob(res, "image/png"))),
        );
        const files = blobs.map(
          (b, i) => new File([b], `previous-chat-${i + 1}.png`, { type: "image/png" }),
        );
        const tokens = pages.reduce((sum, p) => sum + Snapcompact.estimateTokens(p.canvas), 0);
        const preamble =
          `${opts.preamble.trim()}\n\nThe attached image${files.length > 1 ? "s contain" : " contains"} ` +
          `our previous conversation ("${title}"), one line per message: "U:" is me, "A:" is you.`;
        return { text: preamble, files, tokens, note };
      }

      let body = transcript;
      if (opts.format === "toon") {
        body = Lib.jsonToToon({
          title,
          platform: UI._platform?.id || "",
          messages: picked.map((i) => ({ from: i.speaker, text: i.text.trim() })),
        }).replace(/^ /gm, "");
      } else if (opts.format === "minify") {
        body = transcript.replace(/\s+/g, " ").trim();
      }
      const text = wrap(body);
      const method = Tokenizers.METHODS[UI._platform?.id]?.kind;
      const tokens =
        method === "o200k" && Tokenizers.o200k.ready()
          ? Tokenizers.o200k.count(text)
          : Math.round(Utils.estimateTokens(text) * Meter._ratio);
      return { text, files: [], tokens, note };
    },

    /**
     * Builds the package and opens the new chat. A new tab is opened before
     * the first await, while the click still counts as a user gesture, or
     * the browser's popup blocker would stop it.
     */
    async start(report = () => {}) {
      const platform = UI._platform;
      if (!platform) return;
      const opts = Handoff.settings();
      const tab = opts.newTab ? window.open("", "_blank") : null;
      report("Reading the whole conversation…");
      try {
        const pkg = await Handoff.build(opts);
        const id = Math.random().toString(36).slice(2, 10);
        const images = await Promise.all(
          pkg.files.map(
            (f) =>
              new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.onerror = () => rej(reader.error);
                reader.readAsDataURL(f);
              }),
          ),
        );
        Store.set(Config.GM_KEYS.HANDOFF_PENDING, {
          id,
          platform: platform.id,
          createdAt: Date.now(),
          text: pkg.text,
          images,
        });
        const url = `${platform.newChatUrl}#aiutil-handoff=${id}`;
        report(
          `Opening a new chat — ${Handoff.FORMATS[opts.format].name}, ` +
            `~${Utils.formatTokens(pkg.tokens)} tokens, ${pkg.note}.`,
        );
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (e) {
        if (tab) tab.close();
        report(e.message);
      }
    },

    /**
     * On a freshly opened page: if a handoff is waiting for this site (and
     * this is the tab it was meant for), fill the new chat's input box.
     */
    async consumePending() {
      const pending = Store.get(Config.GM_KEYS.HANDOFF_PENDING, null);
      if (!pending || pending.platform !== UI._platform?.id) return;
      if (Date.now() - pending.createdAt > Config.HANDOFF.TTL_MS) {
        Store.set(Config.GM_KEYS.HANDOFF_PENDING, null);
        return;
      }
      const tagged = Handoff._hashAtLoad.includes(`aiutil-handoff=${pending.id}`) ||
        location.hash.includes(`aiutil-handoff=${pending.id}`);
      if (!tagged) return;
      Store.set(Config.GM_KEYS.HANDOFF_PENDING, null);
      if (location.hash.includes("aiutil-handoff="))
        history.replaceState(history.state, "", location.pathname + location.search);

      const deadline = Date.now() + Config.HANDOFF.COMPOSER_WAIT_MS;
      while (!Composer.find() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 400));
      if (!Composer.find()) return;
      // Let the editor finish mounting before writing into it.
      await new Promise((r) => setTimeout(r, 600));
      Composer.setText(pending.text);
      if (pending.images?.length) {
        // Decoded by hand: fetch() on a data: URL can trip a site's connect-src CSP.
        const files = pending.images.map((dataUrl, i) => {
          const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
          const bytes = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
          return new File([bytes], `previous-chat-${i + 1}.png`, { type: "image/png" });
        });
        if (!Composer.attachFiles(files))
          QuickDock.flash("Couldn't attach the chat images — use Snapcompact in the old tab");
      }
      QuickDock.flash("Previous chat loaded as context — add your message and send");
      Meter.tick();
    },
  };

  /* ==========================================================================
   * 10. CHAT EXPORTER — domain logic: extract -> format -> download.
   * Knows nothing about specific sites; everything site-specific comes from
   * the active Platform adapter (see Platforms above) or shared Turndown rules.
   * ========================================================================== */
  const ChatExporter = {
    _currentChatData: null,
    _selectedMessageIds: new Set(),

    /**
     * Reads the DOM via the given platform adapter into a normalized ChatData
     * object.
     */
    extractChatData(platform, doc) {
      const messages = platform.extractMessages(doc);
      if (messages.length === 0) return null;
      let rawTitle = platform.titleFromDoc(doc);
      if (typeof platform.deriveTitleFallback === "function") {
        rawTitle = platform.deriveTitleFallback(rawTitle, messages);
      }
      const { title, tags } = Utils.parseChatTitleAndTags(rawTitle);
      return {
        _raw_title: rawTitle,
        title,
        tags,
        platformId: platform.id,
        messages,
        messageCount: messages.filter((m) => m.author === "user").length,
        exportedAt: new Date(),
        threadUrl: Utils.getCleanUrl(),
      };
    },

    /**
     * Builds a fresh Turndown instance wired with the shared rules + the active
     * platform's rules.
     */
    buildTurndown(platform) {
      const turndown = new Lib.TurndownService();
      SharedTurndownRules.registerAll(turndown, platform);
      if (typeof platform.registerTurndownRules === "function")
        platform.registerTurndownRules(turndown);
      return turndown;
    },

    formatters: {
      markdown(chatData, turndown) {
        let toc = "";
        let content = "";
        let exportChatIndex = 0;
        chatData.messages.forEach((msg) => {
          if (msg.author === "user") {
            exportChatIndex++;
            toc += `- [${exportChatIndex}: ${Utils.escapeMd(Utils.truncate(msg.contentText.replace(/\s+/g, " "), 70))}](#chat-${exportChatIndex})\n`;
            content +=
              `## chat-${exportChatIndex}\n\n> ` +
              msg.contentText.replace(/\n/g, "\n> ") +
              "\n\n";
          } else {
            let md;
            try {
              md = turndown.turndown(msg.contentHtml);
            } catch (e) {
              md = `[CONVERSION ERROR]\n\n\`\`\`\n${msg.contentText}\n\`\`\`\n`;
            }
            content += md + "\n\n" + Config.MARKDOWN.BACK_TO_TOP_LINK;
          }
        });
        const yaml = `---\ntitle: "${chatData.title.replaceAll('"', '\\"')}"\ntags: [${chatData.tags.join(", ")}]\nauthor: ${chatData.platformId}\ncount: ${chatData.messageCount}\nexporter: ${Config.VERSION}\ndate: ${Utils.formatLocalTime(chatData.exportedAt)}\nurl: ${chatData.threadUrl}\n---\n`;
        return {
          output:
            yaml +
            `\n# ${chatData.title}\n\n## Table of Contents\n\n${toc.trim()}\n\n` +
            content.trim() +
            "\n\n",
          fileName: Utils.formatFileName(
            Store.get(
              Config.GM_KEYS.OUTPUT_FILE_FORMAT,
              Config.DEFAULT_OUTPUT_FILE_FORMAT,
            ),
            chatData.title,
            chatData.tags,
            "md",
            chatData.platformId,
          ),
          mimeType: "text/markdown;charset=utf-8",
        };
      },

      json(chatData, turndown) {
        const jsonOutput = {
          title: chatData.title,
          tags: chatData.tags,
          author: chatData.platformId,
          count: chatData.messageCount,
          exporter: Config.VERSION,
          date: chatData.exportedAt.toISOString(),
          url: chatData.threadUrl,
          messages: chatData.messages.map((msg) => {
            let content = msg.contentText;
            if (msg.author !== "user") {
              try {
                content = turndown.turndown(msg.contentHtml);
              } catch (e) {
                content = `[CONVERSION ERROR]: ${msg.contentText}`;
              }
            }
            return {
              id: msg.id.split("-").slice(0, 2).join("-"),
              author: msg.author,
              content,
            };
          }),
        };
        return {
          output: JSON.stringify(jsonOutput, null, 2),
          fileName: Utils.formatFileName(
            Store.get(
              Config.GM_KEYS.OUTPUT_FILE_FORMAT,
              Config.DEFAULT_OUTPUT_FILE_FORMAT,
            ),
            chatData.title,
            chatData.tags,
            "json",
            chatData.platformId,
          ),
          mimeType: "application/json;charset=utf-8",
        };
      },
    },

    /**
     * Reads the current outline selection, builds the export, and triggers a
     * download.
     */
    initiateExport(format, platform) {
      const rawChatData = ChatExporter._currentChatData;
      if (!rawChatData || rawChatData.messages.length === 0)
        return alert("No messages found to export.");

      ChatExporter._selectedMessageIds.clear();
      const outlineListEl = document.querySelector(
        `#${Config.DOM.OUTLINE_LIST_ID}`,
      );
      if (!outlineListEl) {
        // The outline only exists in the DOM while its own section is open, so
        // ALT+M / ALT+J from a closed panel (or another section) has nothing to
        // read. Export the whole conversation rather than failing.
        rawChatData.messages.forEach((m) =>
          ChatExporter._selectedMessageIds.add(m.id),
        );
      }
      if (outlineListEl) {
        const visibleUserMessageIds = new Set();
        outlineListEl
          .querySelectorAll(".outline-item-checkbox:checked")
          .forEach((cb) => {
            const parent = cb.closest("div");
            if (
              parent &&
              window.getComputedStyle(parent).display !== "none" &&
              cb.dataset.messageId
            ) {
              ChatExporter._selectedMessageIds.add(cb.dataset.messageId);
              visibleUserMessageIds.add(cb.dataset.messageId);
            }
          });
        rawChatData.messages.forEach((msg, index) => {
          if (msg.author !== "ai") return;
          for (let i = index - 1; i >= 0; i--) {
            if (rawChatData.messages[i].author === "user") {
              if (visibleUserMessageIds.has(rawChatData.messages[i].id))
                ChatExporter._selectedMessageIds.add(msg.id);
              break;
            }
          }
        });
      }

      const filteredMessages = rawChatData.messages.filter((msg) =>
        ChatExporter._selectedMessageIds.has(msg.id),
      );
      if (filteredMessages.length === 0)
        return alert("No messages selected or visible for export.");

      const exportData = {
        ...rawChatData,
        tags: (rawChatData.tags || [])
          .map((t) =>
            t
              .toLowerCase()
              .replace(/\s+/g, "")
              .replace(/[^a-z0-9_-]/g, ""),
          )
          .filter((t) => t.length > 0),
        messages: filteredMessages,
        messageCount: filteredMessages.filter((m) => m.author === "user")
          .length,
        exportedAt: new Date(),
      };

      const formatter = ChatExporter.formatters[format];
      if (!formatter) return;
      const turndown = ChatExporter.buildTurndown(platform);
      const res = formatter(exportData, turndown);
      if (res.output && res.fileName)
        Utils.downloadFile(res.fileName, res.output, res.mimeType);
    },
  };

  /**
   * Turndown rules shared by every platform (headings, lists, tables, links,
   * ...).
   */
  const SharedTurndownRules = {
    registerAll(turndown, platform) {
      turndown.addRule("lineBreak", { filter: "br", replacement: () => " \n" });
      turndown.addRule("heading", {
        filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
        replacement: (content, node) =>
          `\n\n${"#".repeat(Number(node.nodeName.charAt(1)))} ${content}\n\n`,
      });
      turndown.addRule("customLi", {
        filter: "li",
        replacement: (content, node) => {
          let processed = content.trim();
          if (
            processed.length > 0 &&
            processed.split("\n").length > 1 &&
            /^\s*[-*+]|^[0-9]+\./.test(processed.split("\n")[1])
          ) {
            processed = processed.split("\n").join("\n\n").trim();
          }
          if (node.parentNode.nodeName === "UL") {
            let indent = "";
            let p = node.parentNode;
            while (p) {
              if (p.nodeName === "LI") indent += " ";
              p = p.parentNode;
            }
            return `${indent}${turndown.options.bulletListMarker} ${processed}\n`;
          }
          if (node.parentNode.nodeName === "OL") {
            return `${
              Array.from(node.parentNode.children)
                .filter((c) => c.nodeName === "LI")
                .indexOf(node) + 1
            }. ${processed}\n`;
          }
          return processed + "\n";
        },
      });
      turndown.addRule("code", {
        filter: "code",
        replacement: (content, node) =>
          node.parentNode.nodeName === "PRE" ||
          (platform.id === "grok" &&
            node.closest &&
            node.closest('[data-testid="code-block"]'))
            ? content
            : `\`${content}\``,
      });
      turndown.addRule("strong", {
        filter: ["strong", "b"],
        replacement: (content) => `**${content}**`,
      });
      turndown.addRule("em", {
        filter: ["em", "i"],
        replacement: (content) => `_${content}_`,
      });
      turndown.addRule("blockQuote", {
        filter: "blockquote",
        replacement: (content) =>
          content
            .trim()
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
      });
      turndown.addRule("link", {
        filter: "a",
        replacement: (content, node) =>
          `[${content}](${node.getAttribute("href")})`,
      });
      turndown.addRule("strikethrough", {
        filter: (node) => node.nodeName === "DEL",
        replacement: (content) => `~~${content}~~`,
      });
      turndown.addRule("table", {
        filter: "table",
        replacement: (content, node) => {
          const rowText = (r) =>
            Array.from(r.querySelectorAll("th, td")).map((c) =>
              c.textContent.replace(/\s+/g, " ").trim(),
            );
          const allRowsContent = [
            ...Array.from(node.querySelectorAll("thead tr")).map(rowText),
            ...Array.from(node.querySelectorAll("tbody tr")).map(rowText),
            ...Array.from(node.querySelectorAll("tfoot tr")).map(rowText),
          ];
          if (allRowsContent.length === 0) return "";
          const maxCols = Math.max(...allRowsContent.map((r) => r.length));
          const paddedRows = allRowsContent.map((r) => {
            const p = [...r];
            while (p.length < maxCols) p.push("");
            return p;
          });
          let md = "";
          paddedRows.forEach((r, i) => {
            md += "| " + r.join(" | ") + " |\n";
            if (i === 0)
              md += "|" + Array(maxCols).fill("---").join("|") + "|\n";
          });
          return md.trim();
        },
      });
      turndown.addRule("paragraph", {
        filter: "p",
        replacement: (content, node) => {
          if (!content.trim()) return "";
          let p = node.parentNode;
          while (p) {
            if (Config.PARAGRAPH_FILTER_PARENT_NODES.includes(p.nodeName))
              return content;
            if (p.nodeName === "LI") return content + "\n";
            p = p.parentNode;
          }
          return `\n\n${content}\n\n`;
        },
      });
      turndown.addRule("images", {
        filter: (node) => node.nodeName === "IMG",
        replacement: (content, node) =>
          node.getAttribute("src")
            ? `![${node.alt || ""}](${node.getAttribute("src")})`
            : "",
      });
      turndown.addRule("sub", {
        filter: ["sub"],
        replacement: (content) =>
          content.trim() ? `<sub>${content}</sub>` : "",
      });
      turndown.addRule("sup", {
        filter: ["sup"],
        replacement: (content) =>
          content.trim() ? `<sup>${content}</sup>` : "",
      });
      // NOTE: platform.registerTurndownRules() runs AFTER these and may
      // override
      // "pre"/"code"-family rules with site-specific DOM handling (see
      // Platforms.*).
      turndown.addRule("pre", {
        filter: "pre",
        replacement: (content, node) => {
          const codeText =
            node.querySelector(".cm-content")?.innerText ||
            node.querySelector("code")?.textContent ||
            "";
          if (!codeText && !node.querySelector("code")) return content;
          const lang =
            (node.querySelector("code")?.className.match(/language-(\w+)/) ||
              [])[1] || "";
          return `\n\`\`\`${lang.toLowerCase()}\n${codeText.trim()}\n\`\`\`\n`;
        },
      });
    },
  };

  /* ==========================================================================
   * 11. UI — panel shell, drag handling, and feature "sections".
   * ========================================================================== */
  const UI = {
    _lastProcessedChatUrl: null,
    _initialListenersAttached: false,
    autoScrollEnabled: Store.get(Config.GM_KEYS.AUTO_SCROLL_ENABLED, true),
    quickDockEnabled: Store.get(Config.GM_KEYS.QUICKDOCK_ENABLED, true),
    _activeSectionId: Store.get(Config.GM_KEYS.PANEL_ACTIVE_SECTION, ""),
    _globalCollapsed: Store.get(Config.GM_KEYS.PANEL_GLOBAL_COLLAPSED, false),
    _drag: { active: false, offsetX: 0, offsetY: 0 },
    _sections: {},
    _sourcePickers: [],
    _platform: null,

    /* ---------------- Panel shell + drag ---------------- */
    ensurePanel() {
      let panel = document.getElementById(Config.DOM.PANEL_ID);
      if (panel) return panel;
      Theme.injectStyles();
      panel = document.createElement("div");
      panel.id = Config.DOM.PANEL_ID;

      // Default corner. A stored position is applied after the panel is in the
      // document, since the ratio maths needs its measured size.
      panel.style.right = "20px";
      panel.style.bottom = "20px";
      if (UI._globalCollapsed) panel.classList.add("global-collapsed");

      const rail = document.createElement("div");
      rail.id = "ai-exporter-rail";

      const dots = document.createElement("div");
      dots.id = "ai-exporter-rail-drag";
      dots.title = "Drag to move";
      dots.appendChild(Icons.make("grip", 16));
      rail.appendChild(dots);

      // Two columns, paired by purpose: library | skills, MD | JSON, ...
      // Grid order is row-major, so keep each pair adjacent below.
      const grid = document.createElement("div");
      grid.id = "ai-exporter-rail-grid";
      rail.appendChild(grid);

      grid.appendChild(
        UI.makeRailButton({
          id: "prompts",
          icon: "library",
          tooltip: { title: "Prompt Library", desc: "Save prompts and insert them into the chat.", keys: ["Alt", "P"] },
          onClick: () => UI.showSection("prompts"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "skills",
          icon: "skill",
          tooltip: { title: "Skills Library", desc: "Save skills and bring one into the chat with a click.", keys: ["Alt", "K"] },
          onClick: () => UI.showSection("skills"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "export-md",
          icon: "markdown",
          tooltip: { title: "Export to Markdown", desc: "Pick turns and download a .md file.", keys: ["Alt", "M"] },
          onClick: () => UI.showSection("export-md"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "export-json",
          icon: "json",
          tooltip: { title: "Export to JSON", desc: "Pick turns and download a .json file.", keys: ["Alt", "J"] },
          onClick: () => UI.showSection("export-json"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "toon",
          icon: "toon",
          tooltip: { title: "JSON → TOON", desc: "Turn JSON or the chat into compact, token-saving TOON." },
          onClick: () => UI.showSection("toon"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "minifier",
          icon: "minify",
          tooltip: { title: "Text Minifier", desc: "Collapse whitespace to save tokens." },
          onClick: () => UI.showSection("minifier"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "snapcompact",
          icon: "image",
          tooltip: { title: "Snapcompact", desc: "Render text as dense images." },
          onClick: () => UI.showSection("snapcompact"),
        }),
      );
      grid.appendChild(
        UI.makeRailButton({
          id: "settings",
          icon: "sliders",
          tooltip: { title: "Filename format", desc: "How exported files are named." },
          onClick: () => UI.showSection("settings"),
        }),
      );

      const quickBtn = UI.makeRailButton({
        id: "quickdock",
        icon: "quick",
        tooltip: { title: "Quick Dock", desc: "Show or hide the tool strip over the input box.", keys: ["Alt", "Q"] },
        onClick: () => UI.toggleQuickDock(),
      });
      quickBtn.id = "ai-exporter-rail-quickdock";
      quickBtn.classList.toggle("off", !UI.quickDockEnabled);
      grid.appendChild(quickBtn);

      const meterBtn = UI.makeRailButton({
        id: "meter",
        icon: "gauge",
        tooltip: { title: "Context meter", tag: true, desc: "When to start a new chat." },
        onClick: () => UI.showSection("meter"),
      });
      const badge = document.createElement("span");
      badge.className = "ai-exporter-rail-badge";
      meterBtn.appendChild(badge);
      const meterTip = meterBtn.querySelector(".ai-exporter-tooltip");
      Meter.subscribe("rail", (m) => {
        badge.dataset.level = m.level;
        UI.fillTooltip(meterTip, {
          title: "Context meter",
          tag: true,
          desc:
            `${Meter.LEVELS[m.level].title} — ${m.exact ? "" : "~"}${Utils.formatTokens(m.total)} ` +
            `of ${Utils.formatTokens(m.budget)} tokens.`,
        });
      });
      grid.appendChild(meterBtn);

      grid.appendChild(
        UI.makeRailButton({
          id: "handoff",
          icon: "handoff",
          tooltip: {
            title: "New chat with context",
            tag: true,
            desc: "Carry this whole chat into a fresh one, as text, TOON or images.",
          },
          onClick: () => UI.showSection("handoff"),
        }),
      );

      if (UI._platform?.hasAutoScroll) {
        const scrollBtn = UI.makeRailButton({
          id: "auto-scroll",
          icon: "scrollTop",
          tooltip: { title: "Auto-scroll", desc: `Load the full history before exporting — ${UI.autoScrollEnabled ? "on" : "off"}.`, keys: ["Alt", "A"] },
          onClick: () => UI.toggleAutoScroll(),
        });
        scrollBtn.id = "ai-exporter-rail-scroll";
        scrollBtn.classList.toggle("off", !UI.autoScrollEnabled);
        grid.appendChild(scrollBtn);
      }

      const spacer = document.createElement("div");
      spacer.className = "ai-exporter-rail-spacer";
      rail.appendChild(spacer);

      const eyeBtn = UI.makeRailButton({
        id: "master-eye",
        icon: "eye",
        tooltip: { title: "Collapse the dock", desc: "Click the dot to bring it back. Drag to move." },
        onClick: () => UI.toggleGlobalCollapse(),
      });
      eyeBtn.id = "ai-exporter-rail-master-eye";
      eyeBtn.classList.add("small-btn");
      rail.appendChild(eyeBtn);

      panel.appendChild(rail);

      const content = document.createElement("div");
      content.id = "ai-exporter-content";
      const contentHeader = document.createElement("div");
      contentHeader.id = "ai-exporter-content-header";
      const contentTitle = document.createElement("div");
      contentTitle.id = "ai-exporter-content-title";
      contentHeader.appendChild(contentTitle);
      const closeBtn = document.createElement("button");
      closeBtn.className = "ai-exporter-icon-btn";
      closeBtn.title = "Close";
      closeBtn.appendChild(Icons.make("close", 14));
      closeBtn.onclick = () => UI.closeSection();
      contentHeader.appendChild(closeBtn);
      content.appendChild(contentHeader);
      const contentBody = document.createElement("div");
      contentBody.id = "ai-exporter-content-body";
      content.appendChild(contentBody);
      panel.appendChild(content);

      document.body.appendChild(panel);
      UI.restorePosition(panel);

      UI.attachDrag(dots, panel);
      let eyeDragged = false;
      eyeBtn.addEventListener("mousedown", () => (eyeDragged = false));
      eyeBtn.addEventListener("mousemove", () => (eyeDragged = true));
      UI.attachDrag(eyeBtn, panel);
      eyeBtn.onclick = (e) => {
        e.stopPropagation();
        if (!eyeDragged) UI.toggleGlobalCollapse();
      };

      UI.clampPanelToViewport(panel);
      const reposition = () =>
        UI.clampPanelToViewport(document.getElementById(Config.DOM.PANEL_ID));
      window.addEventListener("resize", reposition);
      window.addEventListener("orientationchange", reposition);
      // On mobile the layout viewport does not change when the URL bar or the
      // on-screen keyboard slides in — only the visual viewport does.
      window.visualViewport?.addEventListener("resize", reposition);
      return panel;
    },

    makeRailButton({ id, icon, emoji, label, tooltip, onClick }) {
      const btn = document.createElement("div");
      btn.className = "ai-exporter-rail-btn";
      btn.dataset.sectionId = id;
      if (icon) {
        const svg = Icons.make(icon);
        svg.classList.add("rail-icon-svg");
        btn.appendChild(svg);
      }
      if (emoji) {
        const e = document.createElement("span");
        e.className = "rail-icon-emoji";
        e.textContent = emoji;
        btn.appendChild(e);
      }
      if (label) {
        const t = document.createElement("span");
        t.className = "rail-icon-text";
        t.textContent = label;
        btn.appendChild(t);
      }
      if (tooltip) {
        const tip = document.createElement("div");
        tip.className = "ai-exporter-tooltip";
        UI.fillTooltip(tip, typeof tooltip === "string" ? { title: tooltip } : tooltip);
        btn.appendChild(tip);
      }
      if (onClick)
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
      return btn;
    },

    /** Puts a native <select> in a wrapper that draws a chevron on its right. */
    wrapSelect(select) {
      const box = document.createElement("div");
      box.className = "ai-exporter-select-wrap";
      box.append(select, Icons.make("chevronDown", 14));
      return box;
    },

    /**
     * Full-screen viewer for rendered pages. Opens at actual pixel size, which
     * is what the model receives, so you can judge whether the text is still
     * legible; "Fit" shrinks it to the screen. A click anywhere outside the
     * toolbar, or Esc, closes it; arrow keys page through.
     * @param {{canvas:HTMLCanvasElement, label?:string}[]} pages
     */
    openLightbox(pages, index = 0) {
      document.getElementById("ai-exporter-lightbox")?.remove();
      const box = document.createElement("div");
      box.id = "ai-exporter-lightbox";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");

      const bar = document.createElement("div");
      bar.className = "lb-bar";
      const info = document.createElement("div");
      info.className = "lb-info";
      const title = document.createElement("span");
      title.className = "lb-title";
      const sub = document.createElement("span");
      sub.className = "lb-sub";
      info.append(title, sub);
      const hint = document.createElement("span");
      hint.className = "lb-hint";
      hint.textContent = "Click anywhere or press Esc to close";
      const button = (icon, text, label) => {
        const b = document.createElement("button");
        b.title = label;
        if (icon) b.appendChild(Icons.make(icon, 16));
        if (text) b.appendChild(document.createTextNode(text));
        return b;
      };
      const prevBtn = button("chevronLeft", "", "Previous page (←)");
      const nextBtn = button("chevronRight", "", "Next page (→)");
      const fitBtn = button("maximize", "Fit", "Toggle fit-to-screen / actual size");
      const closeBtn = button("close", "", "Close (Esc)");
      bar.append(info, hint);
      if (pages.length > 1) bar.append(prevBtn, nextBtn);
      bar.append(fitBtn, closeBtn);

      const stage = document.createElement("div");
      stage.className = "lb-stage";
      box.append(bar, stage);

      let current = index;
      const show = () => {
        const page = pages[current];
        // A copy, drawn from the source canvas: no data: URL for a site's
        // img-src policy to refuse, and the original stays in the panel.
        const view = document.createElement("canvas");
        view.width = page.canvas.width;
        view.height = page.canvas.height;
        view.getContext("2d").drawImage(page.canvas, 0, 0);
        while (stage.firstChild) stage.removeChild(stage.firstChild);
        stage.appendChild(view);
        stage.scrollTo(0, 0);
        title.textContent = pages.length > 1 ? `Page ${current + 1} of ${pages.length}` : "Snapcompact page";
        sub.textContent = `${view.width} × ${view.height}px · ~${Snapcompact.estimateTokens(page.canvas).toLocaleString()} tokens` +
          (page.label ? ` · ${page.label}` : "");
        prevBtn.disabled = current === 0;
        nextBtn.disabled = current === pages.length - 1;
      };
      const setFit = (fit) => {
        box.classList.toggle("fit", fit);
        fitBtn.lastChild.textContent = fit ? "Actual size" : "Fit";
      };
      const close = () => {
        box.remove();
        document.removeEventListener("keydown", onKey, true);
      };
      const go = (step) => {
        const next = current + step;
        if (next < 0 || next >= pages.length) return;
        current = next;
        show();
      };
      // Captured first so the chat site's own shortcuts don't also fire.
      const onKey = (e) => {
        const handled = { Escape: close, ArrowLeft: () => go(-1), ArrowRight: () => go(1) }[e.key];
        if (!handled) return;
        e.preventDefault();
        e.stopPropagation();
        handled();
      };

      bar.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("click", close);
      prevBtn.onclick = () => go(-1);
      nextBtn.onclick = () => go(1);
      fitBtn.onclick = () => setFit(!box.classList.contains("fit"));
      closeBtn.onclick = close;
      document.addEventListener("keydown", onKey, true);

      setFit(false);
      show();
      document.body.appendChild(box);
      closeBtn.focus();
    },

    /** The "Experimental" pill: a flask and the word. */
    makeTag(text = "Experimental") {
      const tag = document.createElement("span");
      tag.className = "ai-exporter-tag";
      tag.title = "Experimental — still being tuned; numbers and behaviour may change";
      tag.append(Icons.make("flask", 10), document.createTextNode(text));
      return tag;
    },

    /** Renders a rail tooltip card: title (+ tag), keys, description. */
    fillTooltip(tip, { title, desc, keys, tag }) {
      while (tip.firstChild) tip.removeChild(tip.firstChild);
      const head = document.createElement("div");
      head.className = "tt-head";
      const titleEl = document.createElement("span");
      titleEl.className = "tt-title";
      titleEl.textContent = title;
      head.appendChild(titleEl);
      if (tag) head.appendChild(UI.makeTag());
      if (keys && keys.length) {
        const keysEl = document.createElement("span");
        keysEl.className = "tt-keys";
        keys.forEach((k) => {
          const kbd = document.createElement("kbd");
          kbd.textContent = k;
          keysEl.appendChild(kbd);
        });
        head.appendChild(keysEl);
      }
      tip.appendChild(head);
      if (desc) {
        const descEl = document.createElement("div");
        descEl.className = "tt-desc";
        descEl.textContent = desc;
        tip.appendChild(descEl);
      }
    },

    attachDrag(handle, panel) {
      const startDrag = (clientX, clientY) => {
        const rect = panel.getBoundingClientRect();
        panel.style.right = "";
        panel.style.bottom = "";
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        UI._drag.active = true;
        UI._drag.offsetX = clientX - rect.left;
        UI._drag.offsetY = clientY - rect.top;
      };
      const moveDrag = (clientX, clientY) => {
        if (!UI._drag.active) return;
        const newX = clientX - UI._drag.offsetX;
        const newY = clientY - UI._drag.offsetY;
        const m = Config.PANEL_EDGE_MARGIN;
        const maxX = window.innerWidth - panel.offsetWidth - m;
        const maxY = window.innerHeight - panel.offsetHeight - m;
        panel.style.left = `${Math.max(m, Math.min(newX, Math.max(m, maxX)))}px`;
        panel.style.top = `${Math.max(m, Math.min(newY, Math.max(m, maxY)))}px`;
        UI.checkScreenEdgesForContent();
      };
      const endDrag = () => {
        if (!UI._drag.active) return;
        UI._drag.active = false;
        UI.savePosition(panel);
      };
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      });
      window.addEventListener("mousemove", (e) =>
        moveDrag(e.clientX, e.clientY),
      );
      window.addEventListener("mouseup", endDrag);
    },

    /* ---------------- Floating Dock position ----------------
     * Stored as a fraction of the free space rather than as pixels.
     *
     * With pixels, resizing to a narrower viewport forced a clamp, the clamp
     * overwrote the saved position, and widening again left the dock wherever
     * the clamp had put it — so cycling through responsive device sizes walked
     * it across the screen. A fraction is stable in both directions: a dock
     * parked on the right edge is at ratio ~1 and stays on the right edge at
     * every width.
     */
    _posRatio: null,

    /** The dock's own left/top. style.* is authoritative once it has moved. */
    currentLeftTop(panel) {
      const left = parseFloat(panel.style.left);
      const top = parseFloat(panel.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    },

    /** Room the dock can travel in, once both margins are taken out. */
    freeSpace(panel) {
      const m = Config.PANEL_EDGE_MARGIN;
      return {
        x: Math.max(0, window.innerWidth - panel.offsetWidth - m * 2),
        y: Math.max(0, window.innerHeight - panel.offsetHeight - m * 2),
      };
    },

    savePosition(panel) {
      const { left, top } = UI.currentLeftTop(panel);
      const free = UI.freeSpace(panel);
      const m = Config.PANEL_EDGE_MARGIN;
      const clamp01 = (n) => Math.min(1, Math.max(0, n));
      UI._posRatio = {
        x: free.x ? clamp01((left - m) / free.x) : 0,
        y: free.y ? clamp01((top - m) / free.y) : 0,
      };
      Store.set(Config.GM_KEYS.PANEL_POS_RATIO_X, UI._posRatio.x);
      Store.set(Config.GM_KEYS.PANEL_POS_RATIO_Y, UI._posRatio.y);
    },

    /** Reads the stored ratio, migrating a pixel position from an older build. */
    restorePosition(panel) {
      const rx = Store.get(Config.GM_KEYS.PANEL_POS_RATIO_X, null);
      const ry = Store.get(Config.GM_KEYS.PANEL_POS_RATIO_Y, null);
      if (rx !== null && ry !== null) {
        UI._posRatio = { x: Number(rx) || 0, y: Number(ry) || 0 };
        UI.clampPanelToViewport(panel);
        return;
      }
      const px = Store.get(Config.GM_KEYS.PANEL_POS_X, null);
      const py = Store.get(Config.GM_KEYS.PANEL_POS_Y, null);
      if (px === null || py === null) return; // never moved — keep the corner
      panel.style.left = `${px}px`;
      panel.style.top = `${py}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      UI.savePosition(panel);
      UI.clampPanelToViewport(panel);
    },

    /**
     * Re-derives left/top from the stored ratio. Non-destructive: the ratio is
     * never rewritten here, only on drag end, so a resize can be undone.
     */
    clampPanelToViewport(panel) {
      if (!panel) return;
      if (UI._posRatio) {
        const free = UI.freeSpace(panel);
        const m = Config.PANEL_EDGE_MARGIN;
        panel.style.left = `${Math.round(m + UI._posRatio.x * free.x)}px`;
        panel.style.top = `${Math.round(m + UI._posRatio.y * free.y)}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
      UI.checkScreenEdgesForContent();
    },

    checkScreenEdgesForContent() {
      const panel = document.getElementById(Config.DOM.PANEL_ID);
      const content = document.getElementById("ai-exporter-content");
      if (!panel || !content) return;
      const rect = panel.getBoundingClientRect();
      const offset = `${Config.PANEL_CONTENT_OFFSET}px`;
      if (rect.left < 300 + Config.PANEL_CONTENT_OFFSET) {
        content.style.right = "auto";
        content.style.left = offset;
        panel.classList.add("on-left");
      } else {
        content.style.left = "auto";
        content.style.right = offset;
        panel.classList.remove("on-left");
      }
    },

    toggleGlobalCollapse() {
      UI._globalCollapsed = !UI._globalCollapsed;
      Store.set(Config.GM_KEYS.PANEL_GLOBAL_COLLAPSED, UI._globalCollapsed);
      const panel = document.getElementById(Config.DOM.PANEL_ID);
      if (panel)
        panel.classList.toggle("global-collapsed", UI._globalCollapsed);
      if (UI._globalCollapsed) UI.closeSection();
      else if (UI._activeSectionId) UI.showSection(UI._activeSectionId);
    },

    toggleQuickDock() {
      UI.quickDockEnabled = !UI.quickDockEnabled;
      Store.set(Config.GM_KEYS.QUICKDOCK_ENABLED, UI.quickDockEnabled);
      document
        .getElementById("ai-exporter-rail-quickdock")
        ?.classList.toggle("off", !UI.quickDockEnabled);
      QuickDock.sync();
    },

    toggleAutoScroll() {
      UI.autoScrollEnabled = !UI.autoScrollEnabled;
      Store.set(Config.GM_KEYS.AUTO_SCROLL_ENABLED, UI.autoScrollEnabled);
      const btn = document.getElementById("ai-exporter-rail-scroll");
      if (!btn) return;
      const isEnabled = UI.autoScrollEnabled;
      btn.classList.toggle("off", !isEnabled);
      const tip = btn.querySelector(".ai-exporter-tooltip");
      if (tip)
        UI.fillTooltip(tip, {
          title: "Auto-scroll",
          desc: `Load the full history before exporting — ${isEnabled ? "on" : "off"}.`,
          keys: ["Alt", "A"],
        });
    },

    /* ---------------- Section switching ---------------- */
    showSection(id) {
      if (UI._activeSectionId === id) {
        UI.closeSection();
        return;
      }
      UI._activeSectionId = id;
      Store.set(Config.GM_KEYS.PANEL_ACTIVE_SECTION, id);
      // The Quick Dock can ask for a section while the rail is collapsed to its
      // eye; open it back up rather than showing content next to nothing.
      if (UI._globalCollapsed) {
        UI._globalCollapsed = false;
        Store.set(Config.GM_KEYS.PANEL_GLOBAL_COLLAPSED, false);
        document
          .getElementById(Config.DOM.PANEL_ID)
          ?.classList.remove("global-collapsed");
      }
      document
        .querySelectorAll(".ai-exporter-rail-btn")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.sectionId === id),
        );

      const contentEl = document.getElementById("ai-exporter-content");
      const contentBody = document.getElementById("ai-exporter-content-body");
      if (!contentEl || !contentBody || !UI._sections[id]) return;

      while (contentBody.firstChild)
        contentBody.removeChild(contentBody.firstChild);
      const titleEl = document.getElementById("ai-exporter-content-title");
      titleEl.textContent = UI._sections[id].title;
      if (UI._sections[id].experimental) titleEl.appendChild(UI.makeTag());
      contentBody.appendChild(UI._sections[id].body);
      contentEl.classList.add("open");
      if (typeof UI._sections[id].onShow === "function")
        UI._sections[id].onShow();

      UI.checkScreenEdgesForContent();
    },

    closeSection() {
      UI._activeSectionId = "";
      Store.set(Config.GM_KEYS.PANEL_ACTIVE_SECTION, "");
      document
        .querySelectorAll(".ai-exporter-rail-btn")
        .forEach((b) => b.classList.remove("active"));
      const contentEl = document.getElementById("ai-exporter-content");
      if (contentEl) contentEl.classList.remove("open");
    },

    buildAllSections() {
      UI._sections = {};
      UI._sourcePickers = [];
      UI.sections.registerPromptsSection();
      UI.sections.registerSkillsSection();
      UI.sections.registerExportSections();
      UI.sections.registerSettingsSection();
      UI.sections.registerMinifierSection();
      UI.sections.registerToonSection();
      UI.sections.registerSnapcompactSection();
      UI.sections.registerMeterSection();
      UI.sections.registerHandoffSection();
    },

    /* ---------------- Feature sections (each is self-contained) ---------------- */
    sections: {
      /**
       * Shared "checklist + download button" body used by both MD and JSON
       * export sections.
       */
      buildOutlineBody(downloadLabel, downloadFormat) {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "8px";
        const downloadBtn = document.createElement("button");
        downloadBtn.className = "ai-exporter-btn";
        downloadBtn.textContent = downloadLabel;
        downloadBtn.onclick = () =>
          ChatExporter.initiateExport(downloadFormat, UI._platform);
        wrap.appendChild(downloadBtn);

        const countPill = document.createElement("span");
        countPill.className = "ai-exporter-count-pill";
        countPill.id = `ai-exporter-outline-count-${downloadFormat}`;
        countPill.textContent = "0 / 0";
        const headerRow = document.createElement("div");
        headerRow.style.display = "flex";
        headerRow.style.justifyContent = "space-between";
        headerRow.style.alignItems = "center";
        const outlineLabel = document.createElement("span");
        outlineLabel.className = "ai-exporter-section-label";
        outlineLabel.textContent = "Chat outline";
        outlineLabel.style.marginBottom = "0";
        headerRow.appendChild(outlineLabel);
        headerRow.appendChild(countPill);
        wrap.appendChild(headerRow);

        const selectAllRow = document.createElement("div");
        selectAllRow.className = "ai-exporter-select-all-row";
        const masterCheckbox = document.createElement("input");
        masterCheckbox.type = "checkbox";
        masterCheckbox.className = "outline-select-all";
        masterCheckbox.checked = true;
        selectAllRow.appendChild(masterCheckbox);
        const selectAllLabel = document.createElement("span");
        selectAllLabel.textContent = "Select all visible";
        selectAllRow.appendChild(selectAllLabel);
        wrap.appendChild(selectAllRow);

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search text or /regex/ …";
        wrap.appendChild(searchInput);
        const noMatchMessage = document.createElement("div");
        noMatchMessage.className = "ai-exporter-status-line";
        noMatchMessage.style.textAlign = "center";
        noMatchMessage.style.padding = "8px 0";
        noMatchMessage.style.display = "none";
        noMatchMessage.textContent = "Your search text didn't match any items";
        wrap.appendChild(noMatchMessage);
        const messageListDiv = document.createElement("div");
        messageListDiv.id = Config.DOM.OUTLINE_LIST_ID;
        wrap.appendChild(messageListDiv);

        const outlineItemElements = new Map();
        let userQuestionCount = 0;
        const updateSelectedCountDisplay = () => {
          let selected = 0;
          messageListDiv
            .querySelectorAll(".outline-item-checkbox:checked")
            .forEach((cb) => {
              if (cb.closest("div")?.style.display !== "none") selected++;
            });
          document
            .querySelectorAll('[id^="ai-exporter-outline-count-"]')
            .forEach(
              (el) => (el.textContent = `${selected} / ${userQuestionCount}`),
            );
        };

        const emptyNote = document.createElement("div");
        emptyNote.className = "ai-exporter-empty-note";
        emptyNote.textContent =
          "Nothing to export yet — send a message first.";
        emptyNote.style.display = "none";
        wrap.appendChild(emptyNote);

        const renderItems = () => {
          // The panel is visible on empty/new chats now, so say why the
          // outline is blank instead of showing an empty box.
          const hasChat = !!(
            ChatExporter._currentChatData &&
            ChatExporter._currentChatData.messages.length
          );
          emptyNote.style.display = hasChat ? "none" : "block";
          downloadBtn.disabled = !hasChat;
          downloadBtn.style.opacity = hasChat ? "" : "0.45";
          if (!hasChat) {
            while (messageListDiv.firstChild)
              messageListDiv.removeChild(messageListDiv.firstChild);
            userQuestionCount = 0;
            updateSelectedCountDisplay();
            return;
          }
          while (messageListDiv.firstChild)
            messageListDiv.removeChild(messageListDiv.firstChild);
          outlineItemElements.clear();
          userQuestionCount = 0;
          ChatExporter._selectedMessageIds.clear();
          ChatExporter._currentChatData.messages.forEach((msg) => {
            if (msg.author !== "user") return;
            userQuestionCount++;
            const itemDiv = document.createElement("div");
            itemDiv.className = "ai-exporter-outline-item";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = true;
            checkbox.className = "outline-item-checkbox";
            checkbox.dataset.messageId = msg.id;
            checkbox.onchange = () => {
              masterCheckbox.checked = Array.from(
                messageListDiv.querySelectorAll(
                  ".outline-item-checkbox:not([style*='display: none'])",
                ),
              ).every((cb) => cb.checked);
              updateSelectedCountDisplay();
            };
            itemDiv.appendChild(checkbox);
            const itemText = document.createElement("span");
            itemText.style.flex = "1";
            itemText.textContent = `${userQuestionCount}: ${Utils.truncate(msg.contentText, 40)}`;
            itemText.title = `${userQuestionCount}: ${Utils.truncate(msg.contentText.replace(/\n+/g, "\n"), 140)}`;
            itemText.onclick = () =>
              ChatExporter._currentChatData.messages
                .find((m) => m.id === msg.id)
                ?.contentHtml?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
            itemDiv.appendChild(itemText);
            messageListDiv.appendChild(itemDiv);
            outlineItemElements.set(msg.id, itemDiv);
            ChatExporter._selectedMessageIds.add(msg.id);
          });
          updateSelectedCountDisplay();
        };

        masterCheckbox.onchange = (e) => {
          messageListDiv
            .querySelectorAll(
              ".outline-item-checkbox:not([style*='display: none'])",
            )
            .forEach((cb) => (cb.checked = e.target.checked));
          updateSelectedCountDisplay();
        };
        searchInput.oninput = () => {
          const searchText = searchInput.value.trim();
          let anyMatch = false;
          let searchRegex;
          noMatchMessage.style.display = "none";
          noMatchMessage.style.color = "";
          noMatchMessage.textContent =
            "Your search text didn't match any items";
          if (searchText) {
            try {
              searchRegex = new RegExp(searchText, "i");
            } catch (e) {
              noMatchMessage.textContent = `Invalid regex: ${e.message}`;
              noMatchMessage.style.color = "#000000";
              noMatchMessage.style.display = "block";
              messageListDiv.style.display = "none";
              outlineItemElements.forEach(
                (item) => (item.style.display = "none"),
              );
              masterCheckbox.checked = false;
              updateSelectedCountDisplay();
              return;
            }
          }
          const messages = ChatExporter._currentChatData.messages;
          const map = new Map();
          for (let i = 0; i < messages.length; i++) {
            if (messages[i].author === "user") {
              map.set(messages[i].id, {
                user: messages[i],
                ai:
                  i + 1 < messages.length && messages[i + 1].author === "ai"
                    ? messages[i + 1]
                    : null,
              });
            }
          }
          outlineItemElements.forEach((item, id) => {
            const pair = map.get(id);
            let match = false;
            if (pair)
              match =
                searchText === "" ||
                (searchRegex &&
                  (searchRegex.test(pair.user.contentText) ||
                    searchRegex.test(pair.ai ? pair.ai.contentText : "")));
            item.style.display = match ? "flex" : "none";
            if (match) anyMatch = true;
          });
          if (searchText && !anyMatch && searchRegex) {
            noMatchMessage.style.display = "block";
            messageListDiv.style.display = "none";
          } else {
            messageListDiv.style.display = "flex";
          }
          const visible = messageListDiv.querySelectorAll(
            ".outline-item-checkbox:not([style*='display: none'])",
          );
          masterCheckbox.checked =
            visible.length > 0 && Array.from(visible).every((cb) => cb.checked);
          updateSelectedCountDisplay();
        };
        return { wrap, renderItems };
      },

      /**
       * The "where does this tool read from?" control shared by the Text
       * Minifier, the JSON->TOON converter and Snapcompact.
       *
       * It carries its own turn checklist rather than reading the export
       * section's outline list: only one section's body is mounted in the
       * panel at a time, so that list is simply not in the document while any
       * of these tools is on screen, and every lookup came back empty.
       *
       * @returns {{select, customInput, refresh, getMessages, getText, getJson}}
       */
      buildSourcePicker(wrap, customPlaceholder) {
        const label = document.createElement("label");
        label.className = "ai-exporter-section-label";
        label.textContent = "Source:";
        wrap.appendChild(label);

        const select = document.createElement("select");
        [
          ["chat-selected", "Current chat — pick turns"],
          ["chat-all", "Current chat — entire conversation"],
          ["custom", "Custom pasted text"],
        ].forEach(([value, text]) => {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = text;
          select.appendChild(opt);
        });
        select.value = "custom";
        wrap.appendChild(UI.wrapSelect(select));

        /* ---- per-tool turn checklist (only shown for "pick turns") ---- */
        const picker = document.createElement("div");
        picker.className = "ai-exporter-fieldset";
        picker.hidden = true;

        const headRow = document.createElement("div");
        headRow.className = "ai-exporter-select-all-row";
        const masterBox = document.createElement("input");
        masterBox.type = "checkbox";
        masterBox.checked = true;
        headRow.appendChild(masterBox);
        const headLabel = document.createElement("span");
        headLabel.textContent = "Select all";
        headLabel.style.flex = "1";
        headLabel.style.cursor = "pointer";
        headRow.appendChild(headLabel);
        const countPill = document.createElement("span");
        countPill.className = "ai-exporter-count-pill";
        countPill.textContent = "0 / 0";
        headRow.appendChild(countPill);
        picker.appendChild(headRow);

        const listEl = document.createElement("div");
        listEl.className = "ai-exporter-msg-list";
        picker.appendChild(listEl);
        wrap.appendChild(picker);

        const customInput = document.createElement("textarea");
        customInput.style.height = "70px";
        customInput.placeholder = customPlaceholder;
        wrap.appendChild(customInput);

        // Chosen user-turn ids. `seen` is what makes "new turns arrive
        // pre-checked" work without also re-checking turns you unticked.
        const chosen = new Set();
        const seen = new Set();
        let signature = "";

        const updateCount = () => {
          const total = listEl.querySelectorAll("input[type=checkbox]").length;
          countPill.textContent = `${chosen.size} / ${total}`;
          masterBox.checked = total > 0 && chosen.size === total;
        };

        const renderChecklist = () => {
          const chatData = ChatExporter._currentChatData;
          const userMessages = chatData
            ? chatData.messages.filter((m) => m.author === "user")
            : [];
          const nextSignature = userMessages.map((m) => m.id).join("|");
          if (nextSignature === signature && listEl.childElementCount) {
            updateCount();
            return;
          }
          signature = nextSignature;

          const liveIds = new Set(userMessages.map((m) => m.id));
          [...seen].forEach((id) => {
            if (!liveIds.has(id)) {
              seen.delete(id);
              chosen.delete(id);
            }
          });

          while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

          if (!userMessages.length) {
            const empty = document.createElement("div");
            empty.className = "ai-exporter-empty-note";
            empty.textContent = "No messages on this page yet.";
            listEl.appendChild(empty);
            updateCount();
            return;
          }

          userMessages.forEach((msg, i) => {
            if (!seen.has(msg.id)) {
              seen.add(msg.id);
              chosen.add(msg.id); // new turns default to included
            }
            const row = document.createElement("div");
            row.className = "ai-exporter-outline-item";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = chosen.has(msg.id);
            box.dataset.messageId = msg.id;
            const text = document.createElement("span");
            text.textContent = `${i + 1}. ${Utils.truncate(
              (msg.contentText || "").replace(/\s+/g, " ").trim(),
              60,
            )}`;
            text.title = Utils.truncate(
              (msg.contentText || "").replace(/\s+/g, " ").trim(),
              300,
            );
            const toggle = () => {
              if (box.checked) chosen.add(msg.id);
              else chosen.delete(msg.id);
              updateCount();
            };
            box.onchange = toggle;
            text.onclick = () => {
              box.checked = !box.checked;
              toggle();
            };
            row.appendChild(box);
            row.appendChild(text);
            listEl.appendChild(row);
          });
          updateCount();
        };

        const setMasterState = (checked) => {
          listEl.querySelectorAll("input[type=checkbox]").forEach((box) => {
            box.checked = checked;
            if (checked) chosen.add(box.dataset.messageId);
            else chosen.delete(box.dataset.messageId);
          });
          updateCount();
        };
        masterBox.onchange = () => setMasterState(masterBox.checked);
        headLabel.onclick = () => {
          masterBox.checked = !masterBox.checked;
          setMasterState(masterBox.checked);
        };

        const applyMode = () => {
          const mode = select.value;
          picker.hidden = mode !== "chat-selected";
          customInput.style.display = mode === "custom" ? "block" : "none";
          if (mode === "chat-selected") renderChecklist();
        };
        select.onchange = applyMode;
        applyMode();

        const getMessages = () => {
          const chatData = ChatExporter._currentChatData;
          if (!chatData || select.value === "custom") return [];
          if (select.value === "chat-all") return chatData.messages;
          // A checked user turn drags its AI replies along with it.
          return chatData.messages.filter((m, idx) => {
            if (m.author === "user") return chosen.has(m.id);
            for (let i = idx - 1; i >= 0; i--)
              if (chatData.messages[i].author === "user")
                return chosen.has(chatData.messages[i].id);
            return false;
          });
        };

        const picked = {
          select,
          customInput,
          /** Re-reads the conversation; call from the section's onShow. */
          refresh() {
            if (select.value === "chat-selected") renderChecklist();
          },
          getMessages,
          /**
           * Plain-text view of the chosen source. Deliberately keeps the
           * original whitespace — the Text Minifier is the thing that strips
           * it, so pre-collapsing here would make it a no-op.
           */
          getText() {
            if (select.value === "custom") return customInput.value;
            return getMessages()
              .map(
                (m) =>
                  `${m.author === "user" ? "U" : "A"}: ${(m.contentText || "").trim()}`,
              )
              .join("\n\n");
          },
          /**
           * JSON view of the chosen source: the pasted JSON, or the chat
           * flattened into a compact { title, platform, messages[] } object.
           */
          getJson() {
            if (select.value === "custom") return JSON.parse(customInput.value);
            const chatData = ChatExporter._currentChatData;
            const messages = getMessages();
            if (!chatData || !messages.length)
              throw new Error("No chat messages selected on this page.");
            return {
              title: chatData.title,
              platform: chatData.platformId,
              exportedAt: new Date().toISOString(),
              messages: messages.map((m) => ({
                role: m.author === "user" ? "user" : "assistant",
                text: (m.contentText || "").replace(/\s+/g, " ").trim(),
              })),
            };
          },
        };

        // UI.refresh() pings every live picker when the conversation changes,
        // so an open checklist picks up new turns as they stream in.
        UI._sourcePickers.push(picked);
        return picked;
      },

      /**
       * Prompt library. Rows insert into the site's composer on click; the
       * "+" form saves a new prompt; the gist panel mirrors everything to a
       * secret gist so the library follows you between machines.
       */
      /** Labels and behaviour that differ between the two libraries. */
      LIBRARIES: {
        prompt: {
          id: "prompts",
          title: "Prompt library",
          noun: "prompt",
          titlePlaceholder: "e.g. Code review checklist",
          bodyLabel: "Prompt:",
          bodyPlaceholder: "Paste your prompt here…",
          mainTip: "Insert into the chat input box",
        },
        skill: {
          id: "skills",
          title: "Skills library",
          noun: "skill",
          titlePlaceholder: "e.g. Code reviewer",
          bodyLabel: "Instructions:",
          bodyPlaceholder: "What the model should do when this skill is in play — steps, rules, output format…",
          mainTip: "Bring this skill into the chat",
        },
      },

      registerPromptsSection() {
        UI.sections.registerLibrarySection("prompt");
      },

      registerSkillsSection() {
        UI.sections.registerLibrarySection("skill");
      },

      /**
       * The Prompt and Skills libraries: one list UI over PromptStore, filtered
       * by kind. Both share the gist settings, since they sync to one gist.
       */
      registerLibrarySection(kind) {
        const spec = UI.sections.LIBRARIES[kind];
        const isSkill = kind === "skill";
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "8px";

        const topRow = document.createElement("div");
        topRow.className = "ai-exporter-btn-row";
        const newBtn = document.createElement("button");
        newBtn.className = "ai-exporter-btn";
        newBtn.textContent = `+ New ${spec.noun}`;
        const syncBtn = document.createElement("button");
        syncBtn.className = "ai-exporter-btn secondary";
        syncBtn.textContent = "Sync gist";
        topRow.appendChild(newBtn);
        // Skills are often shared as SKILL.md files; read one straight in.
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".md,.markdown,.txt,text/markdown,text/plain";
        fileInput.multiple = true;
        fileInput.hidden = true;
        const importBtn = document.createElement("button");
        importBtn.className = "ai-exporter-btn secondary";
        importBtn.textContent = "Import .md";
        importBtn.title = "Add skills from SKILL.md files (name / description front matter is read)";
        if (isSkill) {
          topRow.appendChild(importBtn);
          wrap.appendChild(fileInput);
        }
        topRow.appendChild(syncBtn);
        wrap.appendChild(topRow);

        /* ---- how a skill enters the chat ---- */
        const modeSelect = document.createElement("select");
        if (isSkill) {
          const modeRow = document.createElement("label");
          modeRow.className = "ai-exporter-section-label";
          modeRow.style.display = "flex";
          modeRow.style.alignItems = "center";
          modeRow.style.gap = "6px";
          modeRow.textContent = "On click:";
          [
            ["text", "Type it into the input box"],
            ["file", "Attach it as a .md file"],
          ].forEach(([value, label]) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            modeSelect.appendChild(opt);
          });
          modeSelect.value = Skills.mode();
          modeSelect.onchange = () => Skills.setMode(modeSelect.value);
          const modeBox = UI.wrapSelect(modeSelect);
          modeBox.style.flex = "1";
          modeRow.appendChild(modeBox);
          wrap.appendChild(modeRow);
        }

        /* ---- add / edit form ---- */
        const form = document.createElement("div");
        form.className = "ai-exporter-fieldset";
        form.hidden = true;
        const titleLabel = document.createElement("label");
        titleLabel.className = "ai-exporter-section-label";
        titleLabel.textContent = isSkill ? "Name:" : "Title:";
        form.appendChild(titleLabel);
        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.placeholder = spec.titlePlaceholder;
        form.appendChild(titleInput);
        const descInput = document.createElement("input");
        descInput.type = "text";
        descInput.placeholder = "e.g. reviewing a diff or pull request";
        if (isSkill) {
          const descLabel = document.createElement("label");
          descLabel.className = "ai-exporter-section-label";
          descLabel.textContent = "Use when (optional):";
          form.appendChild(descLabel);
          form.appendChild(descInput);
        }
        const bodyLabel = document.createElement("label");
        bodyLabel.className = "ai-exporter-section-label";
        bodyLabel.textContent = spec.bodyLabel;
        form.appendChild(bodyLabel);
        const bodyInput = document.createElement("textarea");
        bodyInput.style.height = isSkill ? "140px" : "110px";
        bodyInput.placeholder = spec.bodyPlaceholder;
        form.appendChild(bodyInput);
        const formRow = document.createElement("div");
        formRow.className = "ai-exporter-btn-row";
        const saveBtn = document.createElement("button");
        saveBtn.className = "ai-exporter-btn";
        saveBtn.textContent = "Save";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "ai-exporter-btn secondary";
        cancelBtn.textContent = "Cancel";
        formRow.appendChild(saveBtn);
        formRow.appendChild(cancelBtn);
        form.appendChild(formRow);
        wrap.appendChild(form);

        const filterInput = document.createElement("input");
        filterInput.type = "text";
        filterInput.placeholder = `Filter ${spec.noun}s…`;
        wrap.appendChild(filterInput);

        const list = document.createElement("div");
        list.className = "ai-exporter-prompt-list";
        wrap.appendChild(list);

        const status = document.createElement("div");
        status.className = "ai-exporter-status-line";
        wrap.appendChild(status);

        /* ---- gist settings ---- */
        const gistToggle = document.createElement("button");
        gistToggle.className = "ai-exporter-btn secondary";
        gistToggle.textContent = "Gist settings";
        gistToggle.style.marginTop = "2px";
        wrap.appendChild(gistToggle);

        const gistBox = document.createElement("div");
        gistBox.className = "ai-exporter-fieldset";
        gistBox.hidden = true;
        const tokenLabel = document.createElement("label");
        tokenLabel.className = "ai-exporter-section-label";
        tokenLabel.textContent = "GitHub token (scope: gist):";
        gistBox.appendChild(tokenLabel);
        const tokenInput = document.createElement("input");
        tokenInput.type = "password";
        tokenInput.placeholder = "github_pat_… / ghp_…";
        gistBox.appendChild(tokenInput);
        const idLabel = document.createElement("label");
        idLabel.className = "ai-exporter-section-label";
        idLabel.textContent = "Gist id:";
        gistBox.appendChild(idLabel);
        const idInput = document.createElement("input");
        idInput.type = "text";
        idInput.placeholder = "leave empty, then press Create gist";
        gistBox.appendChild(idInput);
        const gistRow = document.createElement("div");
        gistRow.className = "ai-exporter-btn-row";
        const gistSaveBtn = document.createElement("button");
        gistSaveBtn.className = "ai-exporter-btn";
        gistSaveBtn.textContent = "Save";
        const gistCreateBtn = document.createElement("button");
        gistCreateBtn.className = "ai-exporter-btn secondary";
        gistCreateBtn.textContent = "Create gist";
        const gistViewBtn = document.createElement("button");
        gistViewBtn.className = "ai-exporter-btn secondary";
        gistViewBtn.textContent = "View on GitHub";
        gistViewBtn.title = "Open the gist on gist.github.com in a new tab";
        gistRow.appendChild(gistSaveBtn);
        gistRow.appendChild(gistCreateBtn);
        gistRow.appendChild(gistViewBtn);
        gistBox.appendChild(gistRow);
        const gistHelp = document.createElement("div");
        gistHelp.className = "ai-exporter-status-line";
        gistHelp.style.whiteSpace = "pre-line";
        gistHelp.textContent =
          "The token is stored locally by Tampermonkey and only ever sent to " +
          "api.github.com.\nA fine-grained token needs read+write on Gists; a " +
          "classic token needs the 'gist' scope.";
        gistBox.appendChild(gistHelp);
        wrap.appendChild(gistBox);

        /* ---- behaviour ---- */
        let editingId = null;

        const setStatus = (text) => {
          status.textContent = text;
        };

        const openForm = (prompt) => {
          editingId = prompt ? prompt.id : null;
          titleInput.value = prompt ? prompt.title : "";
          descInput.value = prompt ? prompt.description || "" : "";
          bodyInput.value = prompt ? prompt.body : "";
          form.hidden = false;
          newBtn.textContent = prompt ? "Editing…" : `+ New ${spec.noun}`;
          titleInput.focus();
        };

        const closeForm = () => {
          editingId = null;
          form.hidden = true;
          titleInput.value = "";
          descInput.value = "";
          bodyInput.value = "";
          newBtn.textContent = `+ New ${spec.noun}`;
        };

        const insertPrompt = (prompt) => {
          if (isSkill) return setStatus(`${Skills.importToChat(prompt).message}.`);
          if (Composer.insert(prompt.body)) {
            setStatus(`Inserted "${Utils.truncate(prompt.title, 40)}".`);
            return;
          }
          navigator.clipboard
            .writeText(prompt.body)
            .then(() =>
              setStatus("No input box found here — copied to clipboard instead."),
            )
            .catch(() => setStatus("No input box found on this page."));
        };

        const renderList = () => {
          while (list.firstChild) list.removeChild(list.firstChild);
          const needle = filterInput.value.trim().toLowerCase();
          const prompts = PromptStore.list(kind).filter(
            (p) =>
              !needle ||
              p.title.toLowerCase().includes(needle) ||
              String(p.description || "").toLowerCase().includes(needle) ||
              p.body.toLowerCase().includes(needle),
          );

          if (!prompts.length) {
            const empty = document.createElement("div");
            empty.className = "ai-exporter-empty-note";
            empty.textContent = needle
              ? `No ${spec.noun} matches that filter.`
              : isSkill
                ? "No skills yet — press “+ New skill” or import a SKILL.md."
                : "No prompts yet — press “+ New prompt” to save one.";
            list.appendChild(empty);
            return;
          }

          prompts.forEach((prompt) => {
            const row = document.createElement("div");
            row.className = "ai-exporter-prompt-row";

            const main = document.createElement("button");
            main.className = "ai-exporter-prompt-main";
            main.title = spec.mainTip;
            const titleEl = document.createElement("div");
            titleEl.className = "ai-exporter-prompt-title";
            titleEl.textContent = prompt.title;
            const previewEl = document.createElement("div");
            previewEl.className = "ai-exporter-prompt-preview";
            previewEl.textContent = Utils.truncate(
              (prompt.description || prompt.body).replace(/\s+/g, " ").trim(),
              60,
            );
            if (isSkill) {
              titleEl.prepend(Icons.make("skill", 11));
              titleEl.classList.add("with-icon");
            }
            main.appendChild(titleEl);
            main.appendChild(previewEl);
            main.onclick = () => insertPrompt(prompt);
            row.appendChild(main);

            const actions = document.createElement("div");
            actions.className = "ai-exporter-prompt-actions";
            [
              [`copy`, `Copy ${spec.noun}`, () =>
                navigator.clipboard
                  .writeText(isSkill ? Skills.toMarkdown(prompt) : prompt.body)
                  .then(() => setStatus("Copied to clipboard."))],
              ["edit", `Edit ${spec.noun}`, () => openForm(prompt)],
              ["trash", `Delete ${spec.noun}`, () => {
                if (!confirm(`Delete "${prompt.title}"?`)) return;
                PromptStore.remove(prompt.id);
                setStatus("Deleted. Press “Sync gist” to mirror the change.");
              }],
            ].forEach(([icon, tip, handler]) => {
              const btn = document.createElement("button");
              btn.className = "ai-exporter-mini-btn";
              btn.appendChild(Icons.make(icon, 12));
              btn.title = tip;
              btn.onclick = (e) => {
                e.stopPropagation();
                handler();
              };
              actions.appendChild(btn);
            });
            row.appendChild(actions);
            list.appendChild(row);
          });
        };

        newBtn.onclick = () => (form.hidden ? openForm(null) : closeForm());
        cancelBtn.onclick = closeForm;
        filterInput.oninput = renderList;

        saveBtn.onclick = () => {
          const title = titleInput.value.trim();
          const body = bodyInput.value;
          if (!title) return alert(`Give the ${spec.noun} a ${isSkill ? "name" : "title"}.`);
          if (!body.trim()) return alert(`The ${spec.noun} is empty.`);
          const fields = isSkill
            ? { title, body, kind, description: descInput.value.trim() }
            : { title, body };
          if (editingId) PromptStore.update(editingId, fields);
          else PromptStore.add(title, body, isSkill ? fields : {});
          setStatus(`${isSkill ? "Skill" : "Prompt"} ${editingId ? "updated" : "saved"}.`);
          closeForm();
        };

        importBtn.onclick = () => fileInput.click();
        fileInput.onchange = async () => {
          const files = [...fileInput.files];
          fileInput.value = "";
          let added = 0;
          for (const file of files) {
            try {
              const parsed = Skills.parse(await file.text(), file.name.replace(/\.[^.]+$/, ""));
              // A bare SKILL.md has no useful filename; the folder is not sent.
              if (!parsed.body) continue;
              PromptStore.add(parsed.title || "Imported skill", parsed.body, {
                kind,
                description: parsed.description,
              });
              added++;
            } catch (e) {
              /* unreadable file — skipped, counted below */
            }
          }
          setStatus(
            `Imported ${added} skill(s)` +
              (added < files.length ? `, skipped ${files.length - added} empty or unreadable.` : "."),
          );
        };

        gistToggle.onclick = () => {
          gistBox.hidden = !gistBox.hidden;
          if (!gistBox.hidden) {
            const cfg = PromptStore.gist.config();
            tokenInput.value = cfg.token;
            idInput.value = cfg.id;
          }
        };

        gistSaveBtn.onclick = () => {
          PromptStore.gist.setConfig(tokenInput.value, idInput.value);
          setStatus("Gist settings saved.");
        };

        gistViewBtn.onclick = () => {
          const id = idInput.value.trim() || PromptStore.gist.config().id;
          if (!id) return setStatus("No gist id yet — press Create gist first.");
          window.open(PromptStore.gist.webUrl(id), "_blank", "noopener");
        };

        gistCreateBtn.onclick = async () => {
          PromptStore.gist.setConfig(tokenInput.value, idInput.value);
          gistCreateBtn.disabled = true;
          setStatus("Creating secret gist…");
          try {
            const id = await PromptStore.gist.create();
            idInput.value = id;
            setStatus(`Created gist ${id}.`);
          } catch (e) {
            setStatus(`Create failed — ${e.message}`);
          } finally {
            gistCreateBtn.disabled = false;
          }
        };

        syncBtn.onclick = async () => {
          const cfg = PromptStore.gist.config();
          if (!cfg.token || !cfg.id) {
            gistBox.hidden = false;
            tokenInput.value = cfg.token;
            idInput.value = cfg.id;
            return setStatus("Add a token and gist id below first.");
          }
          syncBtn.disabled = true;
          syncBtn.textContent = "Syncing…";
          try {
            const res = await PromptStore.gist.sync();
            setStatus(
              `Synced — ${res.total} prompt(s) and skill(s); ${res.added} new, ${res.updated} updated from gist.`,
            );
          } catch (e) {
            setStatus(`Sync failed — ${e.message}`);
          } finally {
            syncBtn.disabled = false;
            syncBtn.textContent = "Sync gist";
          }
        };

        // Keep the list (and the QuickDock) in step with every store change.
        PromptStore.subscribe(() => {
          renderList();
          if (!isSkill) QuickDock.render();
        });

        // Entry point for the Quick Dock's "+". showSection() toggles, so only
        // call it when the section is not already the open one.
        if (!isSkill)
          UI._openNewPromptForm = () => {
            if (UI._activeSectionId !== "prompts") UI.showSection("prompts");
            openForm(null);
          };

        UI._sections[spec.id] = {
          title: spec.title,
          body: wrap,
          onShow: () => {
            if (isSkill) modeSelect.value = Skills.mode();
            renderList();
            const last = PromptStore.gist.lastSync();
            if (last && !status.textContent)
              setStatus(`Last gist sync: ${new Date(last).toLocaleString()}`);
          },
        };
      },

      registerExportSections() {
        const md = UI.sections.buildOutlineBody(
          "↓ Download Markdown",
          "markdown",
        );
        UI._sections["export-md"] = {
          title: "↓ Markdown export",
          body: md.wrap,
          onShow: md.renderItems,
        };
        UI._renderOutlineItemsMd = md.renderItems;
        const json = UI.sections.buildOutlineBody("↓ Download JSON", "json");
        UI._sections["export-json"] = {
          title: "↓ JSON export",
          body: json.wrap,
          onShow: json.renderItems,
        };
        UI._renderOutlineItemsJson = json.renderItems;
      },

      registerSettingsSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "8px";
        const label = document.createElement("label");
        label.className = "ai-exporter-section-label";
        label.textContent = "Output filename format:";
        wrap.appendChild(label);
        const input = document.createElement("textarea");
        input.style.height = "50px";
        input.value = Store.get(
          Config.GM_KEYS.OUTPUT_FILE_FORMAT,
          Config.DEFAULT_OUTPUT_FILE_FORMAT,
        );
        wrap.appendChild(input);
        const help = document.createElement("div");
        help.className = "ai-exporter-status-line";
        help.style.whiteSpace = "pre-line";
        help.textContent =
          "Placeholders:\n{platform} {title} {timestamp} {timestampLocal}\n{tags} {tag1}..{tag9} {exporter}\n\ne.g. {platform}__{tag1}__{title}__{timestampLocal}";
        wrap.appendChild(help);
        const saveBtn = document.createElement("button");
        saveBtn.className = "ai-exporter-btn";
        saveBtn.textContent = "Save format";
        saveBtn.onclick = () => {
          Store.set(Config.GM_KEYS.OUTPUT_FILE_FORMAT, input.value);
          saveBtn.textContent = "Saved!";
          setTimeout(() => (saveBtn.textContent = "Save format"), 1200);
        };
        wrap.appendChild(saveBtn);
        UI._sections["settings"] = { title: "Settings", body: wrap };
      },

      registerMinifierSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        const source = UI.sections.buildSourcePicker(
          wrap,
          "Enter text with extra spaces, tabs, line breaks...",
        );
        const row = document.createElement("div");
        row.className = "ai-exporter-btn-row";
        const minifyBtn = document.createElement("button");
        minifyBtn.className = "ai-exporter-btn";
        minifyBtn.textContent = "Minify";
        row.appendChild(minifyBtn);
        const copyTextBtn = document.createElement("button");
        copyTextBtn.className = "ai-exporter-btn secondary";
        copyTextBtn.textContent = "Copy Result";
        row.appendChild(copyTextBtn);
        wrap.appendChild(row);
        const textOutput = document.createElement("textarea");
        textOutput.style.height = "70px";
        textOutput.readOnly = true;
        textOutput.placeholder = "Minified result...";
        wrap.appendChild(textOutput);
        const stats = document.createElement("div");
        stats.className = "ai-exporter-status-line";
        wrap.appendChild(stats);
        minifyBtn.onclick = () => {
          const input = source.getText();
          if (!input.trim()) {
            textOutput.value = "";
            stats.textContent =
              source.select.value === "custom"
                ? "Nothing to minify — paste some text."
                : "No chat messages found for that source.";
            return;
          }
          textOutput.value = input.replace(/\s+/g, " ").trim();
          const saved = input.length - textOutput.value.length;
          stats.textContent = `${input.length.toLocaleString()} → ${textOutput.value.length.toLocaleString()} chars (−${saved.toLocaleString()})`;
        };
        copyTextBtn.onclick = () =>
          navigator.clipboard.writeText(textOutput.value).then(() => {
            copyTextBtn.textContent = "Copied!";
            setTimeout(() => (copyTextBtn.textContent = "Copy Result"), 1500);
          });
        UI._sections["minifier"] = {
          title: "Text Minifier",
          body: wrap,
          onShow: source.refresh,
        };
      },

      registerToonSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        const source = UI.sections.buildSourcePicker(
          wrap,
          '{"key": "value", ...}',
        );
        const jsonInput = source.customInput;
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json,.jsonc";
        fileInput.style.display = "none";
        wrap.appendChild(fileInput);
        const row1 = document.createElement("div");
        row1.className = "ai-exporter-btn-row";
        const loadJsonBtn = document.createElement("button");
        loadJsonBtn.className = "ai-exporter-btn secondary";
        loadJsonBtn.textContent = "Load File";
        loadJsonBtn.onclick = () => fileInput.click();
        row1.appendChild(loadJsonBtn);
        const convertBtn = document.createElement("button");
        convertBtn.className = "ai-exporter-btn";
        convertBtn.textContent = "Convert";
        row1.appendChild(convertBtn);
        wrap.appendChild(row1);
        fileInput.onchange = (e) => {
          if (!e.target.files[0]) return;
          source.select.value = "custom";
          source.select.onchange();
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              jsonInput.value = JSON.stringify(
                JSON.parse(event.target.result),
                null,
                2,
              );
            } catch {
              jsonInput.value = event.target.result;
            }
            fileInput.value = "";
          };
          reader.onerror = () => alert("Failed to read file.");
          reader.readAsText(e.target.files[0]);
        };
        const jsonOutput = document.createElement("textarea");
        jsonOutput.style.height = "70px";
        jsonOutput.readOnly = true;
        jsonOutput.placeholder = "TOON output...";
        wrap.appendChild(jsonOutput);
        const copyJsonBtn = document.createElement("button");
        copyJsonBtn.className = "ai-exporter-btn secondary";
        copyJsonBtn.textContent = "Copy TOON";
        wrap.appendChild(copyJsonBtn);
        convertBtn.onclick = () => {
          try {
            // For a chat source this is the exported conversation object; for
            // the custom source it is whatever JSON was pasted or loaded.
            jsonOutput.value = Lib.jsonToToon(source.getJson());
          } catch (e) {
            jsonOutput.value =
              (source.select.value === "custom" ? "Error: Invalid JSON\n" : "Error: ") +
              e.message;
          }
        };
        copyJsonBtn.onclick = () =>
          navigator.clipboard.writeText(jsonOutput.value).then(() => {
            copyJsonBtn.textContent = "Copied!";
            setTimeout(() => (copyJsonBtn.textContent = "Copy TOON"), 1500);
          });
        UI._sections["toon"] = {
          title: "JSON -> TOON",
          body: wrap,
          onShow: source.refresh,
        };
      },

      registerSnapcompactSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        const source = UI.sections.buildSourcePicker(
          wrap,
          "Paste text here...",
        );
        const sourceSelect = source.select;
        const customInput = source.customInput;
        const fontLabel = document.createElement("label");
        fontLabel.className = "ai-exporter-section-label";
        fontLabel.textContent = "Density — font size px:";
        wrap.appendChild(fontLabel);
        const fontInput = document.createElement("input");
        fontInput.type = "number";
        fontInput.min = "6";
        fontInput.max = "24";
        fontInput.value = "10";
        fontInput.style.width = "80px";
        wrap.appendChild(fontInput);
        const renderBtn = document.createElement("button");
        renderBtn.className = "ai-exporter-btn";
        renderBtn.textContent = "Preview Render";
        wrap.appendChild(renderBtn);

        const status = document.createElement("div");
        status.className = "ai-exporter-status-line";
        wrap.appendChild(status);
        const results = document.createElement("div");
        results.style.maxHeight = "260px";
        results.style.overflowY = "auto";
        wrap.appendChild(results);

        const getPages = () => {
          let text = "";
          if (sourceSelect.value === "custom") {
            text = customInput.value.trim();
            try {
              const fChar = text.charAt(0);
              const lChar = text.charAt(text.length - 1);
              if (
                (fChar === "{" && lChar === "}") ||
                (fChar === "[" && lChar === "]")
              )
                text = Lib.jsonToToon(JSON.parse(text));
            } catch (e) {
              /* not JSON — fall through to plain text */
            }
            text = text.replace(/\s+/g, " ").trim();
          } else {
            text = Snapcompact.serialize(source.getMessages());
          }
          return text
            ? Snapcompact.renderPages(text, {
                fontSizePx: parseInt(fontInput.value, 10) || 10,
              })
            : [];
        };

        renderBtn.onclick = () => {
          if (!ChatExporter._currentChatData && sourceSelect.value !== "custom")
            return alert("No chat data found on this page.");
          const pages = getPages();
          if (!pages.length)
            return alert(
              sourceSelect.value === "chat-selected"
                ? "Nothing to render — no turns are ticked in the list above."
                : "Nothing to render — the source is empty.",
            );

          while (results.firstChild) results.removeChild(results.firstChild);
          status.textContent = `${pages.reduce((sum, p) => sum + p.chars, 0).toLocaleString()} chars → ${pages.length} image(s)`;

          // Only offer "Copy Image & Open New Chat" when everything fit on one
          // page.
          if (pages.length === 1) {
            const newChatBtn = document.createElement("button");
            newChatBtn.className = "ai-exporter-btn secondary";
            newChatBtn.textContent = "Copy Image & Open New Chat";
            newChatBtn.style.marginBottom = "8px";
            newChatBtn.style.width = "100%";
            newChatBtn.onclick = async () => {
              newChatBtn.textContent = "Copying...";
              pages[0].canvas.toBlob(async (blob) => {
                try {
                  await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": blob }),
                  ]);
                  newChatBtn.textContent = "Copied!";
                  setTimeout(
                    () =>
                      (newChatBtn.textContent = "Copy Image & Open New Chat"),
                    3000,
                  );
                  alert(
                    "Image copied successfully!\n\nClick OK to open a new chat window. Once there, just press Ctrl+V (or Cmd+V) to paste.",
                  );
                  window.location.href = UI._platform?.newChatUrl || "/";
                } catch (e) {
                  alert(
                    "Clipboard copy failed: " +
                      e.message +
                      "\nMake sure you interact with the page first.",
                  );
                  newChatBtn.textContent = "Copy Image & Open New Chat";
                }
              }, "image/png");
            };
            results.appendChild(newChatBtn);
          }

          pages.forEach((page, i) => {
            const pageWrap = document.createElement("div");
            pageWrap.style.borderTop = `1px solid ${Theme.tokens.borderSoft}`;
            pageWrap.style.paddingTop = "8px";
            pageWrap.style.marginTop = "8px";
            const pageLabel = document.createElement("div");
            pageLabel.className = "ai-exporter-status-line";
            pageLabel.textContent = `Page ${i + 1}/${pages.length} — ~${Snapcompact.estimateTokens(page.canvas).toLocaleString()} tokens`;
            pageWrap.appendChild(pageLabel);
            const previewImg = document.createElement("img");
            previewImg.className = "ai-exporter-preview-img";
            previewImg.src = page.canvas.toDataURL("image/png");
            previewImg.title = "Click to view full size";
            previewImg.onclick = () => UI.openLightbox(pages, i);
            pageWrap.appendChild(previewImg);
            const btnRow = document.createElement("div");
            btnRow.className = "ai-exporter-btn-row";
            btnRow.style.marginTop = "6px";
            const viewBtn = document.createElement("button");
            viewBtn.className = "ai-exporter-btn secondary";
            viewBtn.append(Icons.make("maximize", 13), document.createTextNode("View full size"));
            viewBtn.onclick = () => UI.openLightbox(pages, i);
            btnRow.appendChild(viewBtn);
            const copyBtn = document.createElement("button");
            copyBtn.className = "ai-exporter-btn secondary";
            copyBtn.textContent = "Copy Image";
            copyBtn.onclick = () =>
              page.canvas.toBlob(async (b) => {
                try {
                  await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": b }),
                  ]);
                  copyBtn.textContent = "Copied!";
                  setTimeout(() => (copyBtn.textContent = "Copy Image"), 1500);
                } catch (e) {
                  alert("Failed: " + e.message);
                }
              }, "image/png");
            const downloadBtn = document.createElement("button");
            downloadBtn.className = "ai-exporter-btn secondary";
            downloadBtn.textContent = "Download PNG";
            downloadBtn.onclick = () =>
              page.canvas.toBlob(
                (b) =>
                  Utils.downloadBlob(
                    Utils.formatFileName(
                      Store.get(
                        Config.GM_KEYS.OUTPUT_FILE_FORMAT,
                        Config.DEFAULT_OUTPUT_FILE_FORMAT,
                      ),
                      `${(ChatExporter._currentChatData && ChatExporter._currentChatData.title) || "snapcompact"}-p${i + 1}`,
                      [],
                      "png",
                      UI._platform?.id || "chat",
                    ),
                    b,
                  ),
                "image/png",
              );
            btnRow.appendChild(copyBtn);
            btnRow.appendChild(downloadBtn);
            pageWrap.appendChild(btnRow);
            results.appendChild(pageWrap);
          });
        };

        UI._sections["snapcompact"] = {
          title: "Snapcompact",
          body: wrap,
          onShow: source.refresh,
        };
      },

      /**
       * The detailed view behind the Quick Dock's traffic light: how full the
       * chat is, where the tokens went, and the budget that drives the colours.
       */
      registerMeterSection() {
        const el = (tag, className, text) => {
          const node = document.createElement(tag);
          if (className) node.className = className;
          if (text) node.textContent = text;
          return node;
        };
        const wrap = el("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "8px";

        const status = el("div", "ai-exporter-meter-status");
        const statusTitle = el("b");
        const statusDetail = el("span");
        status.append(statusTitle, statusDetail);
        wrap.appendChild(status);

        const bar = el("div", "ai-exporter-meter-bar");
        const fill = el("div", "ai-exporter-meter-fill");
        const warnTick = el("div", "ai-exporter-meter-tick");
        const critTick = el("div", "ai-exporter-meter-tick");
        bar.append(fill, warnTick, critTick);
        wrap.appendChild(bar);
        const caption = el("div", "ai-exporter-meter-caption");
        const captionUsed = el("span");
        const captionPct = el("span");
        caption.append(captionUsed, captionPct);
        wrap.appendChild(caption);

        const grid = el("div", "ai-exporter-meter-grid");
        const stat = (label) => {
          const value = el("span");
          grid.append(el("span", "", label), value);
          return value;
        };
        const stats = {
          source: stat("Counted from"),
          method: stat("Tokenizer"),
          chat: stat("Conversation"),
          composer: stat("Unsent text in the input box"),
          user: stat("Your messages"),
          ai: stat("AI replies"),
          context: stat("Instructions, memory, tools, files"),
          uncounted: stat("Images / files (not countable)"),
          largest: stat("Largest single item"),
          perTurn: stat("Average per turn"),
          turnsLeft: stat("Turns until red (at that pace)"),
        };
        wrap.appendChild(grid);
        const countStatus = el("div", "ai-exporter-status-line");
        wrap.appendChild(countStatus);

        // The site's own quota numbers, where it publishes them (claude.ai).
        const usageBox = el("div", "ai-exporter-fieldset");
        usageBox.hidden = true;
        usageBox.appendChild(el("span", "ai-exporter-section-label", "Plan usage (from the site)"));
        const usageGrid = el("div", "ai-exporter-meter-grid");
        usageBox.appendChild(usageGrid);
        wrap.appendChild(usageBox);

        const actions = el("div", "ai-exporter-btn-row");
        const handoffBtn = el("button", "ai-exporter-btn", "Ask for handoff summary");
        handoffBtn.title = "Puts a 'summarize this chat for a new one' prompt in the input box";
        const newChatBtn = el("button", "ai-exporter-btn secondary", "New chat with context");
        newChatBtn.title = "Open a new chat with this whole conversation in the input box (options: the arrow button in the dock)";
        const recountBtn = el("button", "ai-exporter-btn secondary", "Recount now");
        recountBtn.title = "Re-read the whole conversation from the site and count it again";
        actions.append(handoffBtn, newChatBtn, recountBtn);
        wrap.appendChild(actions);
        const actionStatus = el("div", "ai-exporter-status-line");
        wrap.appendChild(actionStatus);

        /* ---- budget settings ---- */
        const settings = el("div", "ai-exporter-fieldset");
        const budgetLabel = el("label", "ai-exporter-section-label");
        settings.appendChild(budgetLabel);
        const budgetInput = el("input");
        budgetInput.type = "number";
        budgetInput.min = "1000";
        budgetInput.step = "1000";
        settings.appendChild(budgetInput);
        const pctRow = el("div", "ai-exporter-inline-fields");
        const pctField = (text) => {
          const label = el("label", "", text);
          const input = el("input");
          input.type = "number";
          input.min = "1";
          input.max = "100";
          label.appendChild(input);
          pctRow.appendChild(label);
          return input;
        };
        const warnInput = pctField("Yellow at %");
        const critInput = pctField("Red at %");
        settings.appendChild(pctRow);

        // Only for sites whose exact count needs the provider's API.
        const keyBox = el("div");
        keyBox.style.display = "flex";
        keyBox.style.flexDirection = "column";
        keyBox.style.gap = "4px";
        const keyLabel = el("label", "ai-exporter-section-label");
        const keyInput = el("input");
        keyInput.type = "password";
        const modelLabel = el("label", "ai-exporter-section-label", "Model to count with:");
        const modelInput = el("input");
        modelInput.type = "text";
        const keyHelp = el("div", "ai-exporter-status-line");
        keyBox.append(keyLabel, keyInput, modelLabel, modelInput, keyHelp);
        settings.appendChild(keyBox);

        const settingsRow = el("div", "ai-exporter-btn-row");
        const saveBtn = el("button", "ai-exporter-btn", "Save");
        const resetBtn = el("button", "ai-exporter-btn secondary", "Defaults");
        settingsRow.append(saveBtn, resetBtn);
        settings.appendChild(settingsRow);
        wrap.appendChild(settings);

        const note = el(
          "div",
          "ai-exporter-status-line",
          "The whole conversation is read from the site itself, from the " +
            "first turn. The site's hidden system prompt, images and PDFs " +
            "cannot be counted from here, so the real total is somewhat " +
            "higher. Keep the budget well under the model's context window: " +
            "answers usually get worse long before the hard limit.",
        );
        wrap.appendChild(note);

        const apiProvider = () => Tokenizers.METHODS[UI._platform?.id]?.provider || "";

        const fillSettings = () => {
          const { warn, crit } = Meter.thresholds();
          budgetLabel.textContent = `Token budget for ${UI._platform?.id || "this site"}:`;
          budgetInput.value = Meter.budget();
          warnInput.value = warn;
          critInput.value = crit;
          const provider = apiProvider();
          keyBox.style.display = provider ? "flex" : "none";
          if (!provider) return;
          const info = Tokenizers.PROVIDERS[provider];
          const saved = Tokenizers.settings()[provider] || {};
          keyLabel.textContent = `${info.keyLabel}:`;
          keyInput.placeholder = info.keyHint;
          keyInput.value = saved.key || "";
          modelInput.placeholder = `${info.defaultModel} (or the chat's own model)`;
          modelInput.value = saved.model || "";
          keyHelp.textContent =
            `Exact counts on this site come from the ${info.name} (free). ` +
            "The key stays in Tampermonkey storage and the conversation text " +
            "goes only to that API. Leave it empty to use the estimate.";
        };

        const colors = {
          ok: Theme.tokens.meterOk,
          warn: Theme.tokens.meterWarn,
          crit: Theme.tokens.meterCrit,
        };
        const fmt = Utils.formatTokens;
        Meter.subscribe("section", (m) => {
          wrap.style.setProperty("--meter-color", colors[m.level]);
          statusTitle.textContent = Meter.LEVELS[m.level].title;
          statusDetail.textContent = Meter.LEVELS[m.level].detail;
          fill.style.width = `${Math.min(100, m.pct)}%`;
          warnTick.style.left = `${m.warn}%`;
          critTick.style.left = `${m.crit}%`;
          // "~" marks numbers that are estimated or shared out of an exact total.
          const total = m.exact ? "" : "~";
          const part = m.perExact ? "" : "~";
          captionUsed.textContent = `${total}${fmt(m.total)} / ${fmt(m.budget)} tokens`;
          captionPct.textContent = `${Math.round(m.pct)}%`;
          stats.source.textContent = m.pending
            ? "page (loading history…)"
            : m.source === "history" ? "full history" : "visible page only";
          stats.method.textContent = m.method || "—";
          stats.chat.textContent = `${total}${fmt(m.tokens)} · ${m.messages} msgs`;
          stats.composer.textContent = `${m.exact && m.perExact ? "" : "~"}${fmt(m.composerTokens)}`;
          stats.user.textContent = `${part}${fmt(m.userTokens)} · ${m.turns} turns`;
          stats.ai.textContent = `${part}${fmt(m.aiTokens)}`;
          stats.context.textContent = `${part}${fmt(m.contextTokens)}`;
          stats.uncounted.textContent = m.uncounted ? String(m.uncounted) : "none";
          stats.largest.textContent = `${part}${fmt(m.largest)}`;
          stats.perTurn.textContent = m.perTurn ? `${part}${fmt(Math.round(m.perTurn))}` : "—";
          stats.turnsLeft.textContent =
            m.level === "crit" ? "past it" : m.turnsLeft === null ? "—" : `~${m.turnsLeft}`;
          countStatus.textContent = [
            m.historyError && `Couldn't read the full history (${m.historyError}) — counting the page instead.`,
            m.error,
          ].filter(Boolean).join(" ");

          const limits = m.usage?.limits || [];
          usageBox.hidden = !limits.length;
          while (usageGrid.firstChild) usageGrid.removeChild(usageGrid.firstChild);
          limits.forEach((l) => {
            const when = l.resetsAt ? new Date(l.resetsAt) : null;
            const resets = when && !isNaN(when) ? ` · resets ${when.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "";
            usageGrid.append(el("span", "", l.label), el("span", "", `${Math.round(l.percent)}%${resets}`));
          });
        });

        handoffBtn.onclick = () => {
          if (Composer.insert(Config.METER.HANDOFF_PROMPT)) {
            actionStatus.textContent =
              "Handoff prompt is in the input box — send it, then paste the " +
              "summary into a new chat.";
            return;
          }
          navigator.clipboard
            .writeText(Config.METER.HANDOFF_PROMPT)
            .then(() => (actionStatus.textContent = "No input box found — prompt copied."))
            .catch(() => (actionStatus.textContent = "No input box found on this page."));
        };
        newChatBtn.onclick = () => Handoff.start((msg) => (actionStatus.textContent = msg));
        recountBtn.onclick = () => {
          actionStatus.textContent = "Recounting…";
          clearTimeout(Meter._timer);
          Meter.recount().then(() => (actionStatus.textContent = "Recounted."));
        };
        saveBtn.onclick = () => {
          const warn = Number(warnInput.value);
          const crit = Number(critInput.value);
          if (!(warn > 0 && crit > warn && crit <= 100))
            return (actionStatus.textContent = "Yellow must be below red, both between 1 and 100.");
          Meter.setBudget(Number(budgetInput.value));
          Meter.setThresholds(warn, crit);
          const provider = apiProvider();
          if (provider) {
            Tokenizers.configure(provider, { key: keyInput.value, model: modelInput.value });
            Meter.schedule(true);
          }
          fillSettings();
          actionStatus.textContent = "Meter settings saved.";
        };
        resetBtn.onclick = () => {
          Meter.setBudget(0);
          Meter.setThresholds(Config.METER.WARN_PCT, Config.METER.CRIT_PCT);
          fillSettings();
          actionStatus.textContent = "Back to the default budget and thresholds.";
        };

        UI._sections["meter"] = {
          title: "Context meter",
          experimental: true,
          body: wrap,
          onShow: () => {
            fillSettings();
            actionStatus.textContent = "";
            Meter.notify();
          },
        };
      },

      /**
       * Options for "New chat with context" — the Quick Dock button uses
       * whatever is saved here.
       */
      registerHandoffSection() {
        const el = (tag, className, text) => {
          const node = document.createElement(tag);
          if (className) node.className = className;
          if (text) node.textContent = text;
          return node;
        };
        const wrap = el("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";

        wrap.appendChild(
          el(
            "div",
            "ai-exporter-status-line",
            "Opens a new chat with this whole conversation already in the " +
              "input box, from the first turn. Nothing is sent until you press " +
              "send. The Quick Dock's arrow button uses these settings.",
          ),
        );

        wrap.appendChild(el("span", "ai-exporter-section-label", "Carry the chat over as"));
        const grid = el("div", "ai-exporter-radio-grid");
        const radios = {};
        Object.entries(Handoff.FORMATS).forEach(([key, f]) => {
          const card = el("label", "ai-exporter-radio-card");
          const input = el("input");
          input.type = "radio";
          input.name = "ai-exporter-handoff-format";
          input.value = key;
          card.append(input, el("b", "", f.name), el("span", "", f.detail));
          grid.appendChild(card);
          radios[key] = input;
        });
        wrap.appendChild(grid);

        wrap.appendChild(el("span", "ai-exporter-section-label", "Include"));
        const check = (text) => {
          const row = el("label", "ai-exporter-check-row");
          const input = el("input");
          input.type = "checkbox";
          row.append(input, document.createTextNode(text));
          wrap.appendChild(row);
          return input;
        };
        const attachments = check("Text of attached files");
        const tools = check("Tool calls and results (search, code)");
        const newTab = check("Open in a new tab (keeps this chat open)");

        wrap.appendChild(el("span", "ai-exporter-section-label", "Opening message"));
        const preamble = el("textarea");
        preamble.style.height = "84px";
        preamble.style.fontFamily = "inherit";
        preamble.style.fontSize = "12px";
        wrap.appendChild(preamble);

        const row = el("div", "ai-exporter-btn-row");
        const startBtn = el("button", "ai-exporter-btn", "Start new chat with context");
        const resetBtn = el("button", "ai-exporter-btn secondary", "Defaults");
        row.append(startBtn, resetBtn);
        wrap.appendChild(row);
        const status = el("div", "ai-exporter-status-line");
        wrap.appendChild(status);

        const fill = () => {
          const opts = Handoff.settings();
          (radios[opts.format] || radios.toon).checked = true;
          attachments.checked = opts.attachments;
          tools.checked = opts.tools;
          newTab.checked = opts.newTab;
          preamble.value = opts.preamble;
        };
        // Every change saves at once, so the Quick Dock button is in step.
        const persist = () => {
          Handoff.save({
            format: Object.keys(radios).find((k) => radios[k].checked) || "toon",
            attachments: attachments.checked,
            tools: tools.checked,
            newTab: newTab.checked,
            preamble: preamble.value.trim() ? preamble.value : Config.HANDOFF.DEFAULTS.preamble,
          });
          status.textContent = "Saved.";
        };
        [...Object.values(radios), attachments, tools, newTab].forEach((i) => (i.onchange = persist));
        preamble.onchange = persist;
        startBtn.onclick = () => {
          persist();
          Handoff.start((msg) => (status.textContent = msg));
        };
        resetBtn.onclick = () => {
          Store.set(Config.GM_KEYS.HANDOFF_SETTINGS, {});
          fill();
          status.textContent = "Back to the defaults.";
        };

        UI._sections["handoff"] = {
          title: "New chat with context",
          experimental: true,
          body: wrap,
          onShow: () => {
            fill();
            status.textContent = "";
          },
        };
      },
    },

    /* ---------------- Lifecycle: refresh, observers, autoscroll, shortcuts ---------------- */
    refresh() {
      const panel = UI.ensurePanel();
      if (Object.keys(UI._sections).length === 0) {
        UI.buildAllSections();
        if (
          UI._activeSectionId &&
          UI._sections[UI._activeSectionId] &&
          !UI._globalCollapsed
        )
          UI.showSection(UI._activeSectionId);
      }
      if (!UI._platform) {
        panel.style.display = "none";
        return;
      }
      // The panel stays up even with an empty conversation: on a brand-new
      // chat there are no messages to extract yet, and hiding the panel there
      // is exactly when the Prompt Library and Quick Dock are most useful.
      // Only the chat-dependent sections care whether messages exist.
      panel.style.display = "flex";
      QuickDock.sync();

      const freshChatData = ChatExporter.extractChatData(
        UI._platform,
        document,
      );
      const prev = ChatExporter._currentChatData;
      const hasDataChanged =
        !prev ||
        !freshChatData ||
        freshChatData._raw_title !== prev._raw_title ||
        freshChatData.messages.length !== prev.messages.length ||
        (freshChatData.messages.length > 0 &&
          prev.messages.length > 0 &&
          freshChatData.messages[freshChatData.messages.length - 1]
            .contentText !==
            prev.messages[prev.messages.length - 1].contentText);

      if (!hasDataChanged) return;
      ChatExporter._currentChatData = freshChatData;
      Meter.setChat(freshChatData);
      // Re-render even when the chat went empty (a new chat was opened), so a
      // stale outline from the previous conversation is cleared out.
      if (typeof UI._renderOutlineItemsMd === "function")
        UI._renderOutlineItemsMd();
      if (typeof UI._renderOutlineItemsJson === "function")
        UI._renderOutlineItemsJson();
      UI._sourcePickers.forEach((picker) => picker.refresh());
    },

    /**
     * Gemini-only: repeatedly scrolls to top to force-load full chat history
     * before extraction.
     */
    async autoScrollToTop() {
      if (UI.autoScrollEnabled === false || !UI._platform?.hasAutoScroll)
        return;
      const currentUrl = Utils.getCleanUrl();
      if (UI._lastProcessedChatUrl === currentUrl) return;
      const scrollableElement =
        document.querySelector('[data-test-id="chat-history-container"]') ||
        document.querySelector("#chat-history") ||
        document.querySelector("main") ||
        document.documentElement;
      if (!scrollableElement) return;

      const POLL_INTERVAL = 50;
      const PROGRESS_APPEAR_TIMEOUT = 3000;
      const PROGRESS_DISAPPEAR_TIMEOUT = 5000;
      const REPEAT_DELAY = 500;
      const MAX_RETRY = 3;
      const MESSAGE_APPEAR_TIMEOUT = 5000;
      let previousMessageCount = -1;
      let retriesForProgressBar = 0;
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForElementToAppear = (
        selector,
        timeoutMs,
        checkInterval = POLL_INTERVAL,
      ) => {
        const startTime = Date.now();
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
              clearInterval(interval);
              resolve(element);
            } else if (Date.now() - startTime > timeoutMs) {
              clearInterval(interval);
              resolve(null);
            }
          }, checkInterval);
        });
      };
      const waitForElementToDisappear = (
        selector,
        timeoutMs,
        checkInterval = POLL_INTERVAL,
      ) => {
        const startTime = Date.now();
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (
              !element ||
              (element.offsetWidth === 0 && element.offsetHeight === 0)
            ) {
              clearInterval(interval);
              resolve(true);
            } else if (Date.now() - startTime > timeoutMs) {
              clearInterval(interval);
              resolve(false);
            }
          }, checkInterval);
        });
      };

      const initialMessageElement = await waitForElementToAppear(
        UI._platform.selectors.messageItem,
        MESSAGE_APPEAR_TIMEOUT,
      );
      if (!initialMessageElement) {
        UI._lastProcessedChatUrl = null;
        return;
      }
      UI._lastProcessedChatUrl = currentUrl;
      // (The URL-change observer is installed for every platform in init().)

      while (true) {
        scrollableElement.scrollTop = 0;
        await delay(50);
        const progressBarElement = await waitForElementToAppear(
          "mat-progress-bar.mdc-linear-progress--indeterminate",
          PROGRESS_APPEAR_TIMEOUT,
        );
        if (progressBarElement) {
          retriesForProgressBar = 0;
          await waitForElementToDisappear(
            "mat-progress-bar.mdc-linear-progress--indeterminate",
            PROGRESS_DISAPPEAR_TIMEOUT,
          );
        } else {
          retriesForProgressBar++;
          if (retriesForProgressBar > MAX_RETRY) break;
          await delay(REPEAT_DELAY);
          continue;
        }
        const currentChatData = ChatExporter.extractChatData(
          UI._platform,
          document,
        );
        const currentMessageCount = currentChatData
          ? currentChatData.messages.length
          : 0;
        if (currentMessageCount > previousMessageCount) {
          previousMessageCount = currentMessageCount;
          retriesForProgressBar = 0;
        } else if (previousMessageCount !== -1) {
          break;
        }
        await delay(REPEAT_DELAY);
      }
      UI.refresh();
    },

    handleUrlChange() {
      const newUrl = Utils.getCleanUrl();
      if (
        UI._platform?.hasAutoScroll &&
        UI._platform.hostnames.some((host) => newUrl.includes(host)) &&
        newUrl.includes("/app")
      ) {
        setTimeout(() => UI.autoScrollToTop(), 100);
      }
      // Opening a new chat swaps out the whole composer and empties the
      // message list without necessarily firing a mutation the observer sees,
      // so re-attach after the SPA has settled.
      setTimeout(() => {
        UI.ensurePanel();
        UI.refresh();
      }, 400);
    },

    initObserver() {
      const observer = new MutationObserver(() => {
        if (!document.getElementById(Config.DOM.PANEL_ID)) UI.ensurePanel();
        UI.refresh();
      });
      let targetNode;
      switch (UI._platform?.id) {
        case "copilot":
          targetNode =
            document.querySelector('[data-content="conversation"]') ||
            document.body;
          break;
        case "gemini":
          targetNode = document.querySelector("#__next") || document.body;
          break;
        default:
          targetNode = document.querySelector("main") || document.body;
      }
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      if (UI._platform?.hasAutoScroll) {
        let scrollTimeout;
        window.addEventListener(
          "scroll",
          () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
              const newChatData = ChatExporter.extractChatData(
                UI._platform,
                document,
              );
              const prev = ChatExporter._currentChatData;
              if (
                newChatData &&
                prev &&
                (newChatData._raw_title !== prev._raw_title ||
                  newChatData.messages.length > prev.messages.length)
              )
                UI.refresh();
            }, 500);
          },
          true,
        );
      }
    },

    initUrlChangeObserver() {
      window.addEventListener("popstate", UI.handleUrlChange);
      (function (history) {
        const pushState = history.pushState;
        history.pushState = function (state) {
          if (typeof history.onpushstate === "function")
            history.onpushstate({ state });
          window.dispatchEvent(new Event("customHistoryChange"));
          return pushState.apply(history, arguments);
        };
        const replaceState = history.replaceState;
        history.replaceState = function (state) {
          if (typeof history.onreplacestate === "function")
            history.onreplacestate({ state });
          window.dispatchEvent(new Event("customHistoryChange"));
          return replaceState.apply(history, arguments);
        };
      })(window.history);
      window.addEventListener("customHistoryChange", UI.handleUrlChange);
    },

    setupShortcuts() {
      document.addEventListener("keydown", (e) => {
        if (
          e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable
        )
          return;
        if (e.altKey && e.code === "KeyM") {
          e.preventDefault();
          ChatExporter.initiateExport("markdown", UI._platform);
        }
        if (e.altKey && e.code === "KeyJ") {
          e.preventDefault();
          ChatExporter.initiateExport("json", UI._platform);
        }
        if (e.altKey && e.code === "KeyP") {
          e.preventDefault();
          UI.showSection("prompts");
        }
        if (e.altKey && e.code === "KeyK") {
          e.preventDefault();
          UI.showSection("skills");
        }
        if (e.altKey && e.code === "KeyQ") {
          e.preventDefault();
          UI.toggleQuickDock();
        }
        if (UI._platform?.hasAutoScroll && e.altKey && e.code === "KeyA") {
          e.preventDefault();
          UI.toggleAutoScroll();
        }
      });
    },

    init() {
      UI._platform = Platforms.detectCurrent();
      if (!UI._platform) return; // Unsupported site — do nothing.

      UI.setupShortcuts();
      if (!UI._initialListenersAttached) {
        UI.initUrlChangeObserver();
        UI._initialListenersAttached = true;
      }
      Theme.loadFont();
      const start = () => {
        setTimeout(() => {
          UI.ensurePanel();
          UI.buildAllSections();
          QuickDock.start();
          UI.refresh();
          Handoff.consumePending();
          if (UI._platform.hasAutoScroll)
            setTimeout(
              () => UI.autoScrollToTop(),
              Config.AUTOSCROLL_INITIAL_DELAY_MS,
            );
        }, Config.DOM_READY_TIMEOUT_MS);
      };
      if (
        document.readyState === "complete" ||
        document.readyState === "interactive"
      )
        start();
      else window.addEventListener("DOMContentLoaded", start);
      UI.initObserver();
    },
  };

  /* ==========================================================================
   * 11b. QUICK DOCK — a thin strip of prompt chips docked just above the site's
   * composer, so a saved prompt is one click away from where you are already
   * typing.
   *
   * It is a position: fixed element rather than a child of the composer: every
   * one of these sites re-renders its composer subtree constantly, and an
   * injected child gets wiped (or breaks the editor's own DOM assumptions).
   * Staying outside and re-measuring costs one getBoundingClientRect per tick.
   * ========================================================================== */
  const QuickDock = {
    _el: null,
    _scroll: null,
    _target: null, // the composer card the bar is glued to
    _editor: null, // the text field inside it
    _lastRect: "",
    _timer: null,
    _resizeObserver: null,
    _started: false,
    _toast: null,
    _toastTimer: null,

    makeIcon(icon, title, handler) {
      const btn = document.createElement("button");
      btn.className = "qd-icon";
      btn.title = title;
      if (icon) btn.appendChild(Icons.make(icon, 14));
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler(btn);
      };
      return btn;
    },

    /** A short message above the bar, for tools that change the input box. */
    flash(text) {
      const toast = QuickDock._toast;
      if (!toast) return;
      toast.textContent = text;
      toast.classList.add("show");
      clearTimeout(QuickDock._toastTimer);
      QuickDock._toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
    },

    /**
     * One-click versions of the Floating Dock tools. Each reads the whole
     * input box and writes the result straight back into it; Ctrl+Z in the
     * box undoes the change.
     */
    tools: {
      /** The composer text, or null after saying why there is none. */
      read() {
        const text = Composer.getText();
        if (text === null) QuickDock.flash("No input box found");
        else if (!text.trim()) QuickDock.flash("The input box is empty");
        else return text;
        return null;
      },

      replace(before, after, label) {
        if (after === before) return QuickDock.flash(`${label}: nothing to change`);
        if (!Composer.setText(after)) return QuickDock.flash("No input box found");
        const a = Utils.estimateTokens(before);
        const b = Utils.estimateTokens(after);
        const saved = a ? Math.round(((a - b) / a) * 100) : 0;
        QuickDock.flash(
          `${label}: ~${Utils.formatTokens(a)} → ~${Utils.formatTokens(b)} tokens` +
            (saved > 0 ? ` (−${saved}%)` : ""),
        );
        Meter.tick();
      },

      /** TOON output indents its top level by one space; drop it. */
      toToon(value) {
        return Lib.jsonToToon(value).replace(/^ /gm, "");
      },

      toon() {
        const t = QuickDock.tools;
        const text = t.read();
        if (text === null) return;
        let out;
        try {
          out = t.toToon(JSON.parse(text.trim()));
        } catch (e) {
          // Not one JSON document: convert each fenced JSON block inside a
          // prompt instead, leaving the prose around them alone.
          let converted = 0;
          out = text.replace(/```(?:json5?|jsonc)?[ \t]*\n([\s\S]*?)```/gi, (block, body) => {
            try {
              const toon = t.toToon(JSON.parse(body));
              converted++;
              return "```toon\n" + toon + "\n```";
            } catch (err) {
              return block;
            }
          });
          // Or prose followed by raw JSON: everything from the first line that
          // opens with { or [ to the end of the box.
          const tail = !converted && text.match(/^[[{][\s\S]*$/m);
          if (tail) {
            try {
              out = text.slice(0, tail.index) + t.toToon(JSON.parse(tail[0]));
              converted++;
            } catch (err) {
              /* the tail is not JSON either */
            }
          }
          if (!converted) return QuickDock.flash("No valid JSON in the input box");
        }
        t.replace(text, out, "TOON");
      },

      minify() {
        const t = QuickDock.tools;
        const text = t.read();
        if (text === null) return;
        t.replace(text, text.replace(/\s+/g, " ").trim(), "Minified");
      },

      /** Renders the text to PNG pages and attaches them in its place. */
      async snap(btn) {
        const text = QuickDock.tools.read();
        if (text === null) return;
        let flat = text.trim();
        try {
          if (/^[[{]/.test(flat)) flat = QuickDock.tools.toToon(JSON.parse(flat));
        } catch (e) {
          /* not JSON — render as plain text */
        }
        flat = flat.replace(/\s+/g, " ").trim();
        btn.disabled = true;
        try {
          const pages = Snapcompact.renderPages(flat, { fontSizePx: 10 });
          const blobs = await Promise.all(
            pages.map((p) => new Promise((res) => p.canvas.toBlob(res, "image/png"))),
          );
          const files = blobs.map(
            (b, i) => new File([b], `snapcompact-${i + 1}.png`, { type: "image/png" }),
          );
          // Also on the clipboard, in case the site ignored the attach.
          navigator.clipboard
            .write([new ClipboardItem({ "image/png": blobs[0] })])
            .catch(() => {});
          const imageTokens = pages.reduce(
            (sum, p) => sum + Snapcompact.estimateTokens(p.canvas),
            0,
          );
          const summary =
            `~${Utils.formatTokens(Utils.estimateTokens(text))} text tokens → ` +
            `${pages.length} image${pages.length > 1 ? "s" : ""} ≈ ` +
            `${Utils.formatTokens(imageTokens)}`;
          if (!Composer.attachFiles(files))
            return QuickDock.flash(`Couldn't attach — image copied, press Ctrl+V. ${summary}`);
          Composer.setText("");
          Meter.tick();
          QuickDock.flash(`Attached: ${summary}`);
        } catch (e) {
          QuickDock.flash(`Snapcompact failed: ${e.message}`);
        } finally {
          btn.disabled = false;
        }
      },

      /** Saves the input box as a library prompt; an empty box opens the form. */
      savePrompt() {
        const text = Composer.getText();
        if (!text || !text.trim()) {
          if (typeof UI._openNewPromptForm === "function") UI._openNewPromptForm();
          return;
        }
        const firstLine = text.trim().split("\n")[0];
        const title = window.prompt("Save as prompt — title:", Utils.truncate(firstLine, 40));
        if (title === null) return;
        PromptStore.add(title.trim() || Utils.truncate(firstLine, 40), text);
        QuickDock.flash("Saved to the prompt library");
      },
    },

    ensureEl() {
      if (QuickDock._el && QuickDock._el.isConnected) return QuickDock._el;
      Theme.injectStyles();
      const bar = document.createElement("div");
      bar.id = Config.DOM.QUICKDOCK_ID;

      const scroll = document.createElement("div");
      scroll.className = "qd-scroll";
      bar.appendChild(scroll);

      const tools = document.createElement("div");
      tools.className = "qd-tools";
      const sep = () => {
        const line = document.createElement("span");
        line.className = "qd-sep";
        return line;
      };

      const meterBtn = QuickDock.makeIcon(null, "Context meter", () =>
        UI.showSection("meter"),
      );
      meterBtn.classList.add("qd-meter");
      const dot = document.createElement("span");
      dot.className = "qd-meter-dot";
      meterBtn.appendChild(dot);

      tools.append(
        meterBtn,
        sep(),
        QuickDock.makeIcon("toon", "JSON → TOON: convert the JSON in the input box", () =>
          QuickDock.tools.toon(),
        ),
        QuickDock.makeIcon("minify", "Minify: collapse the whitespace in the input box", () =>
          QuickDock.tools.minify(),
        ),
        QuickDock.makeIcon("image", "Snapcompact: swap the input box text for a dense image", (btn) =>
          QuickDock.tools.snap(btn),
        ),
        QuickDock.makeIcon("bookmarkPlus", "Save the input box text as a prompt", () =>
          QuickDock.tools.savePrompt(),
        ),
        sep(),
        QuickDock.makeIcon(
          "handoff",
          "New chat with this whole chat as context (experimental) — format and options in the Floating Dock",
          () => Handoff.start((msg) => QuickDock.flash(msg)),
        ),
        QuickDock.makeIcon("library", "Open the prompt library", () =>
          UI.showSection("prompts"),
        ),
        QuickDock.makeIcon("skill", "Open the skills library", () =>
          UI.showSection("skills"),
        ),
        QuickDock.makeIcon("close", "Hide the Quick Dock (ALT+Q to bring it back)", () =>
          UI.toggleQuickDock(),
        ),
      );
      bar.appendChild(tools);

      const toast = document.createElement("div");
      toast.className = "qd-toast";
      bar.appendChild(toast);
      QuickDock._toast = toast;

      Meter.subscribe("quickdock", (m) => {
        meterBtn.dataset.level = m.level;
        meterBtn.title =
          `${Meter.LEVELS[m.level].title} — ${m.exact ? "" : "~"}${Utils.formatTokens(m.total)} of ` +
          `${Utils.formatTokens(m.budget)} tokens (${Math.round(m.pct)}%). Context meter, experimental — click for details.`;
        bar.classList.toggle("level-crit", m.level === "crit");
      });

      // Clicking the bar must never steal focus from the composer, otherwise
      // the caret position we are about to insert at is lost.
      bar.addEventListener("mousedown", (e) => e.preventDefault());

      document.body.appendChild(bar);
      QuickDock._el = bar;
      QuickDock._scroll = scroll;
      QuickDock.render();
      return bar;
    },

    /** Rebuilds the chip row: prompts first, then skills (marked with a sparkle). */
    render() {
      if (!QuickDock._scroll) return;
      const scroll = QuickDock._scroll;
      while (scroll.firstChild) scroll.removeChild(scroll.firstChild);

      const prompts = PromptStore.list().slice(0, Config.QUICKDOCK_MAX_CHIPS);
      const skills = PromptStore.list("skill").slice(
        0,
        Math.max(0, Config.QUICKDOCK_MAX_CHIPS - prompts.length),
      );
      if (!prompts.length && !skills.length) {
        const note = document.createElement("span");
        note.className = "qd-empty";
        note.textContent = "No saved prompts — type one in the box and press the bookmark icon";
        scroll.appendChild(note);
        return;
      }

      prompts.forEach((prompt) => {
        const chip = document.createElement("button");
        chip.className = "qd-chip";
        chip.textContent = prompt.title;
        chip.title = Utils.truncate(prompt.body.replace(/\s+/g, " ").trim(), 220);
        chip.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!Composer.insert(prompt.body)) {
            navigator.clipboard.writeText(prompt.body).catch(() => {});
            chip.textContent = "Copied — no input box";
            setTimeout(() => (chip.textContent = prompt.title), 1500);
          }
        };
        scroll.appendChild(chip);
      });

      skills.forEach((skill) => {
        const chip = document.createElement("button");
        chip.className = "qd-chip qd-skill";
        chip.append(Icons.make("skill", 11), document.createTextNode(skill.title));
        chip.title = `Skill — ${Utils.truncate(
          (skill.description || skill.body).replace(/\s+/g, " ").trim(),
          200,
        )}`;
        chip.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          QuickDock.flash(Skills.importToChat(skill).message);
        };
        scroll.appendChild(chip);
      });
    },

    hide() {
      if (QuickDock._el) QuickDock._el.classList.remove("visible");
    },

    // Popups the host sites open from the composer ("+" tools, model picker…).
    // Our z-index sits above most of them, so the bar would cut through them.
    MENU_SELECTORS: [
      "[role='menu']",
      "[role='listbox']",
      "[role='dialog']",
      ".cdk-overlay-pane",
      "[data-radix-popper-content-wrapper]",
    ].join(","),

    /** Hides the bar while any open site menu overlaps it. */
    updateCovered() {
      const bar = QuickDock._el;
      if (!bar || !bar.classList.contains("visible")) return;
      const b = bar.getBoundingClientRect();
      let covered = false;
      for (const menu of document.querySelectorAll(QuickDock.MENU_SELECTORS)) {
        if (bar.contains(menu)) continue;
        const r = menu.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) {
          const style = window.getComputedStyle(menu);
          if (style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0") {
            covered = true;
            break;
          }
        }
      }
      bar.classList.toggle("covered", covered);
    },

    /**
     * Sites float their own buttons in the strip just above the composer
     * (Gemini's "Answer now" while it generates). Our bar is translucent and
     * on top, so it would cut through them.
     * @returns {boolean} whether a site control overlaps the given box.
     */
    hitsControl(top, left, width, height) {
      const bar = QuickDock._el;
      const card = QuickDock._target;
      const controls = "button, a[href], [role='button']";
      const columns = Math.max(1, Math.min(6, Math.round(width / 80)));
      for (let i = 0; i <= columns; i++) {
        const x = left + 4 + ((width - 8) * i) / columns;
        for (const y of [top + 2, top + height / 2, top + height - 2]) {
          for (const hit of document.elementsFromPoint(x, y)) {
            if (bar.contains(hit) || (card && card.contains(hit))) continue;
            const control = hit.closest(controls);
            if (!control) continue;
            const r = control.getBoundingClientRect();
            if (r.width >= 4 && r.height >= 4) return true;
          }
        }
      }
      return false;
    },

    /**
     * Re-measures the composer and glues the bar to its top edge. Cheap enough
     * to call on every tick: it bails out unless the rect actually moved.
     */
    position() {
      const bar = QuickDock._el;
      const target = QuickDock._target;
      if (!bar || !target) return;
      const rect = target.getBoundingClientRect();
      const barHeight = bar.offsetHeight || 32;
      const gap = 6;
      const width = Math.min(rect.width, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      // Prefer sitting above the composer; if there is no room up there (short
      // viewport, composer pinned to the top), sit just below it instead.
      let top = rect.top - barHeight - gap;
      if (top < 4) top = Math.min(rect.bottom + gap, window.innerHeight - barHeight - 4);
      top = Math.max(4, top);

      // Checked every tick: the site's floating buttons come and go while the
      // composer itself stays put.
      const tucked = QuickDock.hitsControl(top, left, width, barHeight);
      const tools = bar.querySelector(".qd-tools");
      const iconsWidth = (tools ? tools.offsetWidth : 96) + 12; // plus padding
      const blocked =
        tucked && QuickDock.hitsControl(top, left + width - iconsWidth, iconsWidth, barHeight);
      // Don't collapse a bar the pointer is on; that would yank it away mid-click.
      if (!bar.matches(":hover")) bar.classList.toggle("tucked", tucked);
      bar.classList.toggle("blocked", blocked);

      const key = `${Math.round(left)},${Math.round(top)},${Math.round(width)},${Math.round(rect.height)},${Math.round(barHeight)}`;
      if (key === QuickDock._lastRect) return;
      QuickDock._lastRect = key;

      // Anchored by its right edge so the tucked icons sit in the corner and
      // the full bar grows leftward from there.
      bar.style.setProperty("--qd-width", `${width}px`);
      bar.style.left = "";
      // clientWidth, not innerWidth: `right` is measured from inside the scrollbar.
      bar.style.right = `${document.documentElement.clientWidth - (left + width)}px`;
      bar.style.top = `${top}px`;
      bar.classList.toggle("compact", width < 320);
    },

    /** Finds/re-finds the composer and shows or hides the bar accordingly. */
    sync() {
      if (!UI._platform) return;
      if (!UI.quickDockEnabled) {
        QuickDock.hide();
        QuickDock._target = null;
        return;
      }
      const bar = QuickDock.ensureEl();
      const editor = Composer.find();
      if (!editor) {
        QuickDock._target = null;
        QuickDock._editor = null;
        QuickDock.hide();
        return;
      }
      // Re-resolve the card only when the editor changes: attachments grow the
      // card, which the observer on it already picks up.
      const target =
        editor === QuickDock._editor && QuickDock._target && QuickDock._target.isConnected
          ? QuickDock._target
          : Composer.frameOf(editor);
      QuickDock._editor = editor;
      if (target !== QuickDock._target) {
        QuickDock._target = target;
        QuickDock._lastRect = "";
        if (QuickDock._resizeObserver) {
          QuickDock._resizeObserver.disconnect();
          QuickDock._resizeObserver.observe(target);
        }
      }
      bar.classList.add("visible");
      QuickDock.position();
    },

    /** Installs the listeners that keep the bar glued to a moving composer. */
    start() {
      if (QuickDock._started) return;
      QuickDock._started = true;

      if (typeof ResizeObserver === "function") {
        QuickDock._resizeObserver = new ResizeObserver(() => {
          QuickDock._lastRect = "";
          QuickDock.position();
        });
      }

      // Capture-phase scroll fires for every scrollable ancestor, so coalesce
      // the measurements into one per frame.
      let frame = 0;
      const reposition = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          QuickDock._lastRect = "";
          QuickDock.position();
        });
      };
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);

      // The composer grows as you type and is swapped out wholesale on
      // navigation, so a slow poll backs up the observers.
      QuickDock._timer = setInterval(() => {
        if (!QuickDock._target || !QuickDock._target.isConnected)
          QuickDock.sync();
        else QuickDock.position();
        QuickDock.updateCovered();
        Meter.tick();
      }, Config.QUICKDOCK_POLL_MS);

      // Menus open and close on a click or key press, often with a short
      // animation, so re-check right after one instead of waiting for the poll.
      const checkMenus = () => {
        [0, 120, 350].forEach((ms) => setTimeout(QuickDock.updateCovered, ms));
      };
      document.addEventListener("click", checkMenus, true);
      document.addEventListener("keydown", checkMenus, true);

      // refresh() may already have found a composer before the observer
      // existed; clearing the target makes the next sync re-attach it.
      QuickDock._target = null;
      QuickDock.sync();
    },
  };

  /* ==========================================================================
   * 12. BOOTSTRAP
   * ========================================================================== */
  GM_registerMenuCommand("Set Gemini Chat Title Prefix", () => {
    const currentPrefix = Store.get(
      Config.GM_KEYS.CHAT_TITLE_PREFIX,
      Config.DEFAULT_CHAT_TITLE_PREFIX,
    );
    const newPrefix = prompt(
      "Enter the prefix you want to use: \n" +
        "You only need to set this if you use the 'Set Gemini Chat Title Prefix' Tampermonkey script.",
      currentPrefix,
    );
    if (newPrefix !== null && newPrefix !== currentPrefix) {
      Store.set(Config.GM_KEYS.CHAT_TITLE_PREFIX, newPrefix);
      alert(
        `Prefix updated to "${newPrefix}". Please refresh page to apply to future exports.`,
      );
    }
  });

  GM_registerMenuCommand("Reset Panel Position", () => {
    Store.set(Config.GM_KEYS.PANEL_POS_X, null);
    Store.set(Config.GM_KEYS.PANEL_POS_Y, null);
    alert("Panel position reset. Please refresh the page.");
  });

  UI.init();
})();
