'use strict';
/*
 * Is the internet on? navigator.onLine only says the computer is on a network (Wi-Fi
 * without internet still counts), so followMe also asks a tiny "no content" page on
 * the internet (prefs.online_url) through Moss, which a page's own rules can't block.
 * The answer is kept for a few seconds so checking before every step costs nothing.
 *
 * struct net (one, below) {
 *     online: boolean | null;   null = not checked yet
 *     checked_at: number;       when it was last asked
 *     asking: Promise | null;   the question in flight, shared by every caller
 *     listeners: function[];    called with the new answer when it changes
 * }
 */

const ONLINE_URL = 'https://www.gstatic.com/generate_204';
const ONLINE_CACHE_MS = 5000;     // answers younger than this are reused
const ONLINE_TIMEOUT_MS = 6000;   // no reply in this long = offline
const OFFLINE_RETRY_MS = 3000;    // how often to ask again while offline

const net = { online: null, checked_at: 0, asking: null, listeners: [] };

/*
 * on_online_change(fn) — fn(online) is called whenever the answer changes
 */
function on_online_change(fn) {
    net.listeners.push(fn);
}

/*
 * set_online(online) — store the answer and tell the listeners if it changed
 */
function set_online(online) {
    const changed = net.online !== online;
    net.online = online;
    net.checked_at = Date.now();
    if (!changed) {
        return;
    }
    for (const fn of net.listeners) {
        try {
            fn(online);
        } catch (e) {
            console.error('followMe:', e);
        }
    }
}

/*
 * probe(url) -> Promise<boolean>: true if the page at url answered
 */
function probe(url) {
    return new Promise(function (resolve) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            resolve(navigator.onLine);
            return;
        }
        GM_xmlhttpRequest({
            method: 'HEAD',
            url: `${url}${url.indexOf('?') >= 0 ? '&' : '?'}fm=${Date.now()}`,
            timeout: ONLINE_TIMEOUT_MS,
            anonymous: true,
            onload: function (response) {
                resolve(response.status >= 200 && response.status < 400);
            },
            onerror: function () {
                resolve(false);
            },
            ontimeout: function () {
                resolve(false);
            },
        });
    });
}

/*
 * check_online(fresh) -> Promise<boolean>; fresh skips the kept answer
 */
async function check_online(fresh) {
    if (!navigator.onLine) {
        set_online(false);
        return false;
    }
    if (!fresh && net.online !== null && Date.now() - net.checked_at < ONLINE_CACHE_MS) {
        return net.online;
    }
    if (net.asking === null) {
        net.asking = probe(load_prefs().online_url || ONLINE_URL).then(function (online) {
            net.asking = null;
            set_online(online);
            return online;
        });
    }
    return net.asking;
}

/*
 * wait_online(run, timeout_ms, on_wait) -> 'ok' | 'timeout' | 'stopped' once the
 *   internet is on; timeout_ms 0 waits as long as it takes
 */
async function wait_online(run, timeout_ms, on_wait) {
    const end = timeout_ms > 0 ? Date.now() + timeout_ms : Infinity;
    while (true) {
        if (await check_online(true)) {
            return 'ok';
        }
        if (Date.now() >= end) {
            return 'timeout';
        }
        if (!(await sleep(run, Math.min(OFFLINE_RETRY_MS, end - Date.now()), typeof on_wait !== 'function' ? null : function () {
            on_wait(end === Infinity ? 0 : end - Date.now());
        }))) {
            return 'stopped';
        }
    }
}

/*
 * watch_network() — ask again as soon as the browser says the network came or went
 */
function watch_network() {
    window.addEventListener('online', function () {
        check_online(true);
    });
    window.addEventListener('offline', function () {
        set_online(false);
    });
}
