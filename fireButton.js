/*
 * File: fireButton.js
 * Author: vididvidid
 * Created: 2026-10-27
 *
 * Pre-requisite:
 * - Runs in Moss (not Tampermonkey): it is a background script with browser
 *   APIs, which Tampermonkey can't do. Paste this file into Moss → + Script.
 * - Moss asks for the browsingData, history and tabs permissions on save.
 *
 * Two commands in the Moss toolbar popup:
 * - 🔥 Burn this tab — closes the tab you're on and wipes that site:
 *   cookies, storage, cache and its history entries.
 * - 🔥 Burn all — closes every tab and wipes all browsing data.
 */

// ==UserScript==
// @name         Fire button
// @namespace    https://github.com/vididvidid/DailyScripts
// @version      2.0.0
// @description  DuckDuckGo-style Fire button: burn this tab, or burn everything.
// @author       vididvidid
// @sandbox      extension
// @grant        chrome.browsingData
// @grant        chrome.history
// @grant        chrome.tabs
// ==/UserScript==

const ALL_DATA = {
  history: true, downloads: true, cookies: true, cache: true, cacheStorage: true,
  localStorage: true, indexedDB: true, serviceWorkers: true, fileSystems: true, formData: true,
};

// Per-site wipes can only use the data types Chrome allows with an origin filter.
const SITE_DATA = {
  cookies: true, cache: true, cacheStorage: true, localStorage: true,
  indexedDB: true, serviceWorkers: true, fileSystems: true,
};

// Closing the last tab of a window closes the window, so leave a fresh tab behind.
async function closeTabs(tabs, windowId) {
  if (!tabs.length) return;
  const left = await moss.chrome.tabs.query({ windowId });
  if (left.every((t) => tabs.some((x) => x.id === t.id))) await moss.chrome.tabs.create({ windowId, active: true });
  await moss.chrome.tabs.remove(tabs.map((t) => t.id));
}

async function burnThisTab() {
  const [tab] = await moss.chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  const url = /^https?:/.test(tab.url || '') ? new URL(tab.url) : null;

  await closeTabs([tab], tab.windowId);
  if (!url) {
    GM_notification({ title: '🔥 Burned', text: 'Closed the tab.' });
    return;
  }

  await moss.chrome.browsingData.remove({ origins: [url.origin] }, SITE_DATA);
  const visits = await moss.chrome.history.search({ text: url.hostname, startTime: 0, maxResults: 10000 });
  const mine = visits.filter((v) => new URL(v.url).hostname === url.hostname);
  for (const v of mine) await moss.chrome.history.deleteUrl({ url: v.url });

  GM_notification({ title: '🔥 Burned', text: `Closed the tab and wiped ${url.hostname}.` });
}

async function burnAll() {
  const tabs = await moss.chrome.tabs.query({});
  // One fresh tab survives; everything else goes.
  await moss.chrome.tabs.create({ active: true });
  await moss.chrome.tabs.remove(tabs.map((t) => t.id));
  await moss.chrome.browsingData.remove({ since: 0 }, ALL_DATA);
  GM_notification({ title: '🔥 Burned', text: `Closed ${tabs.length} tab${tabs.length === 1 ? '' : 's'} and wiped everything.` });
}

GM_registerMenuCommand('🔥 Burn this tab', burnThisTab);
GM_registerMenuCommand('🔥 Burn all', burnAll);
