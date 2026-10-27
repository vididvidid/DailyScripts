/*
 * File: template.js
 * Author: vididvidid
 * Created: 2026-07-27 22:57:32
 *
 * Starting point for a new script, and the live-reload workflow for working on the
 * scripts in this repo.
 *
 * Live reload in Moss (no stub needed):
 * - Every script in this repo carries its own header, so there is nothing to paste
 *   here. In the Moss dashboard: + Script (or open the script), then
 *   Options → Source → "Link a local file…" and pick the file — on Windows Chrome
 *   that can be \\wsl.localhost\Ubuntu\home\kali\DailyScripts\youtubenotes.js.
 * - Moss reloads the script every time you save the file, while a Moss page (the
 *   dashboard) is open. After a browser restart, click Reconnect once.
 * - To track the published version instead: Import… → paste the GitHub link, with
 *   auto-update on.
 *
 * Live reload in Tampermonkey (the old way):
 * - chrome://extensions → Tampermonkey → allow access to file URLs, and in its
 *   dashboard → Settings → Config mode = Advanced → Externals = Always.
 * - Add a line under @match:
 *       // @require  file:////wsl.localhost/Ubuntu/home/kali/DailyScripts/[FILE_NAME].js
 *   and keep this file's body empty. (Moss can't read file:// URLs — use the
 *   local-file link above there.)
 *
 * Notes on the grants below:
 * - GM_xmlhttpRequest + @connect api.github.com are what let AiUtil.js sync the
 *   prompt library, and youtubenotes.js sync its watched list, to a GitHub Gist.
 *   The AI chat sites' CSP blocks a plain fetch() to api.github.com, so AiUtil
 *   genuinely needs these. YouTube sets no connect-src, so youtubenotes would
 *   survive on fetch() alone — keep them anyway: GM_xmlhttpRequest sidesteps
 *   CORS entirely and keeps working if YouTube ever tightens its CSP.
 * - @connect gist.githubusercontent.com is only needed once a gist file grows
 *   past 1 MB, when GitHub stops inlining it and hands back a raw URL instead.
 * - GM_setValue/GM_getValue are where the GitHub token is kept. Without them it
 *   falls back to localStorage, where any script on the page could read it.
 * - Drop these lines only if you use neither gist sync.
 * - @sandbox: leave it out to run sandboxed (safest). Use @sandbox JavaScript
 *   when the script must see the page's own variables through unsafeWindow, as
 *   youtubenotes.js does — in Moss the GM_* functions still work there.
 */

// ==UserScript==
// @name         [SCRIPT_NAME]
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.1.0
// @description  [What it does]
// @author       vididvidid
// @match        https://[TARGET_WEBSITE]/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Your script here.
})();
