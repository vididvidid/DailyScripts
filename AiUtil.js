/*
 * File: AiUtil.js
 * Author: vididvidid , mic mejia
 * Created: 2026-08-07 18:58:38
 */

// ==UserScript==
// @name         ChatGPT / Claude / Copilot / Gemini / Grok AI Chat Exporter by RevivalStack
// @namespace    [old]https://github.com/revivalstack/chatgpt-exporter
// @version      3.6.0
// @description  Export your ChatGPT, Claude, Copilot, Gemini or Grok chat into a properly and elegantly formatted Markdown or JSON. Includes Text Minifier, JSON→TOON converter and Snapcompact — in one draggable, two-column icon-dock panel.
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
 *   4. Lib            - vendored third-party-style libs (Turndown, TOON)
 *   5. Snapcompact    - "chat -> compact PNG" rendering engine
 *   6. Platforms      - one adapter per AI site (THE extension point).
 *                       To support a new site: add one object here, done.
 *   7. ChatExporter   - core domain logic: extract -> format -> download.
 *                       Delegates all site-specific work to Platforms.
 *   8. UI             - panel shell, drag handling, sections (the "app").
 *   9. Bootstrap      - wires everything together and starts the script.
 *
 * To add a new export format:      add a formatter in ChatExporter.formatters
 * To add a new AI site:            add an entry to Platforms.registry
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
    VERSION: "3.6.0",
    DOM_READY_TIMEOUT_MS: 1000,
    AUTOSCROLL_INITIAL_DELAY_MS: 2000,

    DEFAULT_CHAT_TITLE: "chat",
    DEFAULT_OUTPUT_FILE_FORMAT: "{platform}_{title}_{timestampLocal}",
    DEFAULT_CHAT_TITLE_PREFIX: "",

    DOM: {
      PANEL_ID: "ai-exporter-panel",
      PANEL_BODY_ID: "ai-exporter-panel-body",
      OUTLINE_LIST_ID: "ai-exporter-outline-list",
    },

    // Tampermonkey GM_* storage keys, centralized so nothing is a magic string.
    GM_KEYS: {
      OUTPUT_FILE_FORMAT: "aiChatExporter_fileFormat",
      PANEL_POS_X: "aiChatExporter_panelPosX",
      PANEL_POS_Y: "aiChatExporter_panelPosY",
      PANEL_GLOBAL_COLLAPSED: "aiChatExporter_globalCollapsed",
      PANEL_ACTIVE_SECTION: "aiChatExporter_panelActiveSection",
      CHAT_TITLE_PREFIX: "aiChatExporter_chatTitlePrefix",
      AUTO_SCROLL_ENABLED: "gm_auto_scroll_enabled",
    },

    MARKDOWN: {
      TOC_PLACEHOLDER_LINK: "#table-of-contents",
      get BACK_TO_TOP_LINK() {
        return `___\n###### [top](${Config.MARKDOWN.TOC_PLACEHOLDER_LINK})\n`;
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
    fontStack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,

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
                #${Config.DOM.PANEL_ID} * { box-sizing: border-box; }

                /* ---------- Icon rail (Fixed dimensions, anchors panel) ---------- */
                #ai-exporter-rail {
                    width: 52px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0; /* Remove gap to ensure contiguous hit areas */
                    padding: 8px 6px;
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
                }
                #ai-exporter-rail-drag:active { cursor: grabbing; }
                .ai-exporter-rail-spacer { flex: 1; min-height: 4px; }

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
                
                /* Fisheye Dock Effect - Gradient Black */
                .ai-exporter-rail-btn:hover {
                    width: 48px;
                    height: 48px;
                    z-index: 10;
                    background-color: rgba(0, 0, 0, 0.85); /* Main focus black */
                    color: #ffffff;
                    border-radius: 14px;
                    border-width: 2px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                }
                .ai-exporter-rail-btn:hover .rail-icon-emoji { font-size: 20px; }
                .ai-exporter-rail-btn:hover .rail-icon-text { font-size: 11px; opacity: 1; color: #ffffff; }

                /* Immediate siblings */
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn:hover),
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn {
                    width: 42px;
                    height: 42px;
                    z-index: 9;
                    background-color: rgba(0, 0, 0, 0.5); /* Lighter black */
                    color: #ffffff;
                    border-radius: 12px;
                    border-width: 2px;
                }
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn:hover) .rail-icon-emoji,
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn .rail-icon-emoji { font-size: 16px; }
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn:hover) .rail-icon-text,
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn .rail-icon-text { font-size: 10px; color: #ffffff; }

                /* 2nd level siblings */
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn + .ai-exporter-rail-btn:hover),
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn + .ai-exporter-rail-btn {
                    width: 38px;
                    height: 38px;
                    z-index: 8;
                    background-color: rgba(0, 0, 0, 0.25); /* More light black */
                    border-radius: 10px;
                    border-width: 2px;
                }
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn + .ai-exporter-rail-btn:hover) .rail-icon-emoji,
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn + .ai-exporter-rail-btn .rail-icon-emoji { font-size: 14px; }
                .ai-exporter-rail-btn:has(+ .ai-exporter-rail-btn + .ai-exporter-rail-btn:hover) .rail-icon-text,
                .ai-exporter-rail-btn:hover + .ai-exporter-rail-btn + .ai-exporter-rail-btn .rail-icon-text { font-size: 9px; }

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

                .ai-exporter-tooltip {
                    position: absolute;
                    top: 50%;
                    right: calc(100% + 12px);
                    transform: translateY(-50%);
                    background: #ffffff;
                    border: 1px solid ${t.borderSoft};
                    border-radius: 8px;
                    padding: 8px 10px;
                    font-size: 11px;
                    color: ${t.textLight};
                    white-space: normal;
                    max-width: 50ch;
                    box-shadow: ${t.shadow};
                    display: none;
                    z-index: 2147483001;
                    pointer-events: none;
                }
                #${Config.DOM.PANEL_ID}.on-left .ai-exporter-tooltip {
                    right: auto;
                    left: calc(100% + 12px);
                }
                .ai-exporter-rail-btn:hover .ai-exporter-tooltip { display: block; }
                .ai-exporter-tooltip .ai-exporter-shortcut-row { white-space: nowrap; }

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
                #${Config.DOM.PANEL_ID}.global-collapsed .ai-exporter-rail-spacer {
                    display: none !important;
                }
                #${Config.DOM.PANEL_ID}.global-collapsed #ai-exporter-rail-master-eye {
                    width: 100%; height: 100%; border-radius: 50%; border: none; margin: 0;
                }

                /* ---------- Content column (Floating to side of rail) ---------- */
                #ai-exporter-content {
                    position: absolute;
                    right: 60px;
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
                    flex: 1; font-size: 13px; font-weight: 700;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    color: ${t.textLight};
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
                    color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
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
                #${Config.DOM.PANEL_ID} select, #${Config.DOM.PANEL_ID} input[type="number"] {
                    width: 100%; background: ${t.inputBg}; color: ${t.inputText};
                    border: 1px solid ${t.borderSoft}; border-radius: 6px;
                    padding: 6px 8px; font-size: 12px; font-family: ${Theme.fontStack};
                }
                #${Config.DOM.PANEL_ID} input[type="text"]:focus, #${Config.DOM.PANEL_ID} textarea:focus { outline: 2px solid #000000; }
                #${Config.DOM.PANEL_ID} textarea { resize: vertical; font-family: monospace; }
                .ai-exporter-select-all-row {
                    display: flex; align-items: center; gap: 6px; font-size: 11px;
                    color: ${t.textLight}; margin-bottom: 6px;
                }
                #${Config.DOM.OUTLINE_LIST_ID} {
                    max-height: 220px; overflow-y: auto; display: flex; flex-direction: column;
                    gap: 3px; margin-top: 6px;
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
                .ai-exporter-status-line { font-size: 11px; color: ${t.textMuted}; }
                .ai-exporter-preview-img {
                    width: 100%; max-height: 160px; object-fit: contain; background: #fff;
                    border-radius: 6px; border: 1px solid ${t.borderSoft}; margin-top: 6px; image-rendering: pixelated;
                }
                .ai-exporter-section-label { font-weight: 600; display: block; margin-bottom: 4px; }

                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar { width: 7px; }
                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.4); border-radius: 6px; }
                #${Config.DOM.PANEL_ID} ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.05); }
                #${Config.DOM.PANEL_ID} { scrollbar-color: rgba(0, 0, 0, 0.4) rgba(0, 0, 0, 0.05); scrollbar-width: thin; }
            `;
      document.head.appendChild(style);
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
   * 4. LIB — small vendored libraries. Framework-agnostic, no Config/Theme deps.
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
   * 5. SNAPCOMPACT — renders serialized chat text into dense PNG "pages".
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
     * 6. PLATFORMS — one adapter per AI chat site. THIS IS THE EXTENSION POINT.
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
  xporter and UI never branch on "if platform === X" — they only ever
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
   * 7. CHAT EXPORTER — domain logic: extract -> format -> download.
   * Knows nothing about specific sites; everything site-specific comes from
   * the active Platform adapter (see Platforms abo) or shared Turndown rules.
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
   * 8. UI — panel shell, drag handling, and feature "sections".
   * ========================================================================== */
  const UI = {
    _lastProcessedChatUrl: null,
    _initialListenersAttached: false,
    autoScrollEnabled: Store.get(Config.GM_KEYS.AUTO_SCROLL_ENABLED, true),
    _activeSectionId: Store.get(Config.GM_KEYS.PANEL_ACTIVE_SECTION, ""),
    _globalCollapsed: Store.get(Config.GM_KEYS.PANEL_GLOBAL_COLLAPSED, false),
    _drag: { active: false, offsetX: 0, offsetY: 0 },
    _sections: {},
    _platform: null,

    /* ---------------- Panel shell + drag ---------------- */
    ensurePanel() {
      let panel = document.getElementById(Config.DOM.PANEL_ID);
      if (panel) return panel;
      Theme.injectStyles();
      panel = document.createElement("div");
      panel.id = Config.DOM.PANEL_ID;

      const savedX = Store.get(Config.GM_KEYS.PANEL_POS_X, null);
      const savedY = Store.get(Config.GM_KEYS.PANEL_POS_Y, null);
      if (savedX !== null && savedY !== null) {
        panel.style.left = `${savedX}px`;
        panel.style.top = `${savedY}px`;
      } else {
        panel.style.right = "20px";
        panel.style.bottom = "20px";
      }
      if (UI._globalCollapsed) panel.classList.add("global-collapsed");

      const rail = document.createElement("div");
      rail.id = "ai-exporter-rail";

      const dots = document.createElement("div");
      dots.id = "ai-exporter-rail-drag";
      dots.textContent = "::";
      rail.appendChild(dots);

      rail.appendChild(
        UI.makeRailButton({
          id: "export-md",
          label: "MD",
          tooltip: `AI Chat Exporter v${Config.VERSION}: Export to Markdown (ALT+M)`,
          onClick: () => UI.showSection("export-md"),
        }),
      );
      rail.appendChild(
        UI.makeRailButton({
          id: "export-json",
          label: "JD",
          tooltip: `AI Chat Exporter v${Config.VERSION}: Export to JSON (ALT+J)`,
          onClick: () => UI.showSection("export-json"),
        }),
      );
      rail.appendChild(
        UI.makeRailButton({
          id: "settings",
          label: "URL",
          tooltip: "Configure output filename format",
          onClick: () => UI.showSection("settings"),
        }),
      );
      rail.appendChild(
        UI.makeRailButton({
          id: "toon",
          label: "JT",
          tooltip: "JSON → TOON converter",
          onClick: () => UI.showSection("toon"),
        }),
      );
      rail.appendChild(
        UI.makeRailButton({
          id: "minifier",
          label: "TM",
          tooltip: "Text Minifier",
          onClick: () => UI.showSection("minifier"),
        }),
      );
      rail.appendChild(
        UI.makeRailButton({
          id: "snapcompact",
          label: "IC",
          tooltip: "Snapcompact — Render compact image",
          onClick: () => UI.showSection("snapcompact"),
        }),
      );

      if (UI._platform?.hasAutoScroll) {
        const scrollBtn = UI.makeRailButton({
          id: "auto-scroll",
          emoji: "^",
          label: UI.autoScrollEnabled ? "ON" : "OFF",
          tooltip: `Auto-scroll (ALT+A)`,
          onClick: () => UI.toggleAutoScroll(),
        });
        scrollBtn.id = "ai-exporter-rail-scroll";
        rail.appendChild(scrollBtn);
      }

      const spacer = document.createElement("div");
      spacer.className = "ai-exporter-rapacer";
      rail.appendChild(spacer);

      const eyeBtn = UI.makeRailButton({
        id: "master-eye",
        emoji: "O",
        label: "",
        tooltip: "Show / Hide AI Exporter Panel",
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
      closeBtn.textContent = "✕";
      closeBtn.onclick = () => UI.closeSection();
      contentHeader.appendChild(closeBtn);
      content.appendChild(contentHeader);
      const contentBody = document.createElement("div");
      contentBody.id = "ai-exporter-content-body";
      content.appendChild(contentBody);
      panel.appendChild(content);

      document.body.appendChild(panel);

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
      window.addEventListener("resize", () =>
        UI.clampPanelToViewport(document.getElementById(Config.DOM.PANEL_ID)),
      );
      return panel;
    },

    makeRailButton({ id, emoji, label, tooltip, onClick }) {
      const btn = document.createElement("div");
      btn.className = "ai-exporter-rail-btn";
      btn.dataset.sectionId = id;
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
        tip.textContent = tooltip;
        btn.appendChild(tip);
      }
      if (onClick)
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
      return btn;
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
        const maxX = window.innerWidth - panel.offsetWidth - 4;
        const maxY = window.innerHeight - panel.offsetHeight - 4;
        panel.style.left = `${Math.max(4, Math.min(newX, Math.max(4, maxX)))}px`;
        panel.style.top = `${Math.max(4, Math.min(newY, Math.max(4, maxY)))}px`;
        UI.checkScreenEdgesForContent();
      };
      const endDrag = () => {
        if (!UI._drag.active) return;
        UI._drag.active = false;
        const rect = panel.getBoundingClientRect();
        Store.set(Config.GM_KEYS.PANEL_POS_X, Math.round(rect.left));
        Store.set(Config.GM_KEYS.PANEL_POS_Y, Math.round(rect.top));
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

    clampPanelToViewport(panel) {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      let left = rect.left;
      let top = rect.top;
      let changed = false;
      const maxX = window.innerWidth - rect.width - 4;
      const maxY = window.innerHeight - rect.height - 4;
      if (left > maxX) {
        left = Math.max(4, maxX);
        changed = true;
      }
      if (top > maxY) {
        top = Math.max(4, maxY);
        changed = true;
      }
      if (left < 4) {
        left = 4;
        changed = true;
      }
      if (top < 4) {
        top = 4;
        changed = true;
      }
      if (changed || panel.style.left) {
        panel.style.left = `${left}px`;
        panel.style.right = "auto";
      }
      if (changed || panel.style.top) {
        panel.style.top = `${top}px`;
        panel.style.bottom = "auto";
      }
      UI.checkScreenEdgesForContent();
    },

    checkScreenEdgesForContent() {
      const panel = document.getElementById(Config.DOM.PANEL_ID);
      const content = document.getElementById("ai-exporter-content");
      if (!panel || !content) return;
      const rect = panel.getBoundingClientRect();
      if (rect.left < 360) {
        content.style.right = "auto";
        content.style.left = "60px";
        panel.classList.add("on-left");
      } else {
        content.style.left = "auto";
        content.style.right = "60px";
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

    toggleAutoScroll() {
      UI.autoScrollEnabled = !UI.autoScrollEnabled;
      Store.set(Config.GM_KEYS.AUTO_SCROLL_ENABLED, UI.autoScrollEnabled);
      const btn = document.getElementById("ai-exporter-rail-scroll");
      if (!btn) return;
      const isEnabled = UI.autoScrollEnabled;
      const labelEl = btn.querySelector(".rail-icon-text");
      if (labelEl) labelEl.textContent = isEnabled ? "ON" : "OFF";
      const tip = btn.querySelector(".ai-exporter-tooltip");
      if (tip)
        tip.textContent = `Auto-scroll is ${isEnabled ? "ON" : "OFF"} (ALT+A)`;
    },

    /* ---------------- Section switching ---------------- */
    showSection(id) {
      UI._activeSectionId = id;
      Store.set(Config.GM_KEYS.PANEL_ACTIVE_SECTION, id);
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
      document.getElementById("ai-exporter-content-title").textContent =
        UI._sections[id].title;
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
      UI.sections.registerExportSections();
      UI.sections.registerSettingsSection();
      UI.sections.registerMinifierSection();
      UI.sections.registerToonSection();
      UI.sections.registerSnapcompactSection();
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

        const renderItems = () => {
          if (!ChatExporter._currentChatData) return;
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
        const label = document.createElement("label");
        label.className = "ai-exporter-section-label";
        label.textContent = "Paste text:";
        wrap.appendChild(label);
        const textInput = document.createElement("textarea");
        textInput.style.height = "70px";
        textInput.placeholder =
          "Enter text with extra spaces, tabs, line breaks...";
        wrap.appendChild(textInput);
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
        minifyBtn.onclick = () =>
          (textOutput.value = textInput.value.replace(/\s+/g, " ").trim());
        copyTextBtn.onclick = () =>
          navigator.clipboard.writeText(textOutput.value).then(() => {
            copyTextBtn.textContent = "Copied!";
            setTimeout(() => (copyTextBtn.textContent = "Copy Result"), 1500);
          });
        UI._sections["minifier"] = { title: "Text Minifier", body: wrap };
      },

      registerToonSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        const label = document.createElement("label");
        label.className = "ai-exporter-section-label";
        label.textContent = "Paste JSON:";
        wrap.appendChild(label);
        const jsonInput = document.createElement("textarea");
        jsonInput.style.height = "70px";
        jsonInput.placeholder = '{"key": "value", ...}';
        wrap.appendChild(jsonInput);
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
        const convertBtn = document.createElement("buon");
        convertBtn.className = "ai-exporter-btn";
        convertBtn.textContent = "Convert";
        row1.appendChild(convertBtn);
        wrap.appendChild(row1);
        fileInput.onchange = (e) => {
          if (!e.target.files[0]) return;
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
            jsonOutput.value = Lib.jsonToToon(JSON.parse(jsonInput.value));
          } catch (e) {
            jsonOutput.value = "Error: Invalid JSON\n" + e.message;
          }
        };
        copyJsonBtn.onclick = () =>
          navigator.clipboard.writeText(jsonOutput.value).then(() => {
            copyJsonBtn.textContent = "Copied!";
            setTimeout(() => (copyJsonBtn.textContent = "Copy TOON"), 1500);
          });
        UI._sections["toon"] = { title: "JSON -> TOON", body: wrap };
      },

      registerSnapcompactSection() {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        const sourceLabel = document.createElement("label");
        sourceLabel.className = "ai-exporter-section-label";
        sourceLabel.textContent = "Source:";
        wrap.appendChild(sourceLabel);
        const sourceSelect = document.createElement("select");
        [
          ["chat-selected", "Current chat — checked items"],
          ["chat-all", "Current chat — entire conversation"],
          ["custom", "Custom pasted text"],
        ].forEach(([v, l]) => {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = l;
          sourceSelect.appendChild(opt);
        });
        wrap.appendChild(sourceSelect);
        const customInput = document.createElement("textarea");
        customInput.style.height = "60px";
        customInput.style.display = "none";
        customInput.placeholder = "Paste text here...";
        wrap.appendChild(customInput);
        sourceSelect.onchange = () =>
          (customInput.style.display =
            sourceSelect.value === "custom" ? "block" : "none");
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

        function getSelectedMessagesForSnapcompact(chatData) {
          const selectedIds = new Set();
          document
            .getElementById(Config.DOM.OUTLINE_LIST_ID)
            ?.querySelectorAll(".outline-item-checkbox:checked")
            .forEach((cb) => {
              if (cb.dataset.messageId) selectedIds.add(cb.dataset.messageId);
            });
          return chatData.messages.filter((m, idx) => {
            if (m.author === "user") return selectedIds.has(m.id);
            for (let i = idx - 1; i >= 0; i--)
              if (chatData.messages[i].author === "user")
                return selectedIds.has(chatData.messages[i].id);
            return false;
          });
        }

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
            const msgs =
              sourceSelect.value === "chat-selected"
                ? getSelectedMessagesForSnapcompact(
                    ChatExporter._currentChatData,
                  )
                : ChatExporter._currentChatData.messages;
            text = Snapcompact.serialize(msgs);
          }
          return text
            ? Snapcompact.renderPages(text, {
                fontSizePx: parseInt(fontInput.value, 10) || 10,
              })
            : [];
        };

        renderBtn.onclick = () => {
          if (!ChatExporter._currentChatData && sourceSelect.value !== "custom")
            return alert("No chat data found.");
          const pages = getPages();
          if (!pages.length)
            return alert("Nothing to render — selection is empty.");

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
                  newChatBtn.texontent = "Copy Image & Open New Chat";
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
            pageWrap.appendChild(previewImg);
            const btnRow = document.createElement("div");
            btnRow.className = "ai-exporter-btn-row";
            btnRow.style.marginTop = "6px";
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

        UI._sections["snapcompact"] = { title: "Snapcompact", body: wrap };
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
          UI.showSection(UI._actiSectionId);
      }
      if (!UI._platform) {
        panel.style.display = "none";
        return;
      }
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

      if (!hasDataChanged) {
        panel.style.display =
          freshChatData && freshChatData.messages.length > 0 ? "flex" : "none";
        return;
      }
      ChatExporter._currentChatData = freshChatData;
      if (!freshChatData || freshChatData.messages.length === 0) {
        panel.style.display = "none";
        return;
      }
      panel.style.display = "flex";
      if (typeof UI._renderOutlineItemsMd === "function")
        UI._renderOutlineItemsMd();
      if (typeof UI._renderOutlineItemsJson === "function")
        UI._renderOutlineItemsJson();
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
      if (!UI._initialListenersAttached) {
        UI.initUrlChangeObserver();
        UI._initialListenersAttached = true;
      }

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
      const start = () => {
        setTimeout(() => {
          UI.ensurePanel();
          UI.buildAllSections();
          UI.refresh();
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
   * 9. BOOTSTRAP
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
