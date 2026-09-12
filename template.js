/*
 * File: template.js
 * Author: vididvidid 
 * Created: 2026-07-27 22:57:32
 *
 * Pre-requisite:
 * - in chrome://extensions -> go to tampermonkey -> allow access to file URIs
 * - tampermonkey extension -> dashboard -> setting 
 *                -> config mode = advanced
 *                -> externals = always
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
 */

// ==UserScript==
// @name         [DEV STUB] [SCRIPT_NAME]
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.1.0
// @description  Live-reloading local dev stub linked to WSL repository
// @author       vididvidid
// @match        https://[TARGET_WEBSITE]/*
// @require      file:////wsl.localhost/Ubuntu/home/kali/aiutils/[FILE_NAME].js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

// This stub remains empty. All logic executes from the @require file in WSL.
