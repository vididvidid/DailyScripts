'use strict';
/*
 * The checks a step can wait for, before or after its action:
 *
 *   loaded       the page has fully loaded: the document says "complete", and then
 *                nothing new was downloaded and nothing on the page changed for a
 *                short quiet time — so a single-page app that draws its content
 *                after "load" counts as loaded only once it settles
 *   url_changed  the address differs from the one before the action (single-page
 *                apps change it without reloading, so it is watched, not awaited)
 *   url_matches  the address matches a "*" glob or /regex/
 *   online       the internet is on (see net.js)
 *   wait         a fixed time
 *
 * Every wait returns 'ok', 'timeout' or 'stopped'.
 */

const QUIET_MS = 700;      // "settled" = this long with no downloads and no DOM changes
const POLL_MS = 100;

/*
 * resource_count() -> how many files the page has started downloading so far
 */
function resource_count() {
    try {
        return performance.getEntriesByType('resource').length;
    } catch (e) {
        return 0;
    }
}

/*
 * wait_until(run, timeout_ms, test, on_wait) -> 'ok' | 'timeout' | 'stopped';
 *   polls test() until it is true
 */
async function wait_until(run, timeout_ms, test, on_wait) {
    const end = Date.now() + timeout_ms;
    while (true) {
        if (run !== null && run.stopped) {
            return 'stopped';
        }
        if (test()) {
            return 'ok';
        }
        if (Date.now() >= end) {
            return 'timeout';
        }
        if (on_wait) {
            on_wait(end - Date.now());
        }
        await pause(POLL_MS);
    }
}

/*
 * wait_loaded(run, timeout_ms, on_wait) -> 'ok' | 'timeout' | 'stopped'
 */
async function wait_loaded(run, timeout_ms, on_wait) {
    const end = Date.now() + timeout_ms;
    const ready = await wait_until(run, timeout_ms, function () {
        return document.readyState === 'complete';
    }, on_wait);
    if (ready !== 'ok') {
        return ready;
    }
    // Then wait for a quiet moment: no new downloads, no DOM changes.
    let last_change = Date.now();
    let last_count = resource_count();
    const observer = new MutationObserver(function () {
        last_change = Date.now();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    try {
        return await wait_until(run, Math.max(0, end - Date.now()), function () {
            const count = resource_count();
            if (count !== last_count) {
                last_count = count;
                last_change = Date.now();
            }
            return Date.now() - last_change >= QUIET_MS;
        }, on_wait);
    } finally {
        observer.disconnect();
    }
}

/*
 * run_check(run, check, url_before, on_wait) -> 'ok' | 'timeout' | 'stopped'
 *   url_before: the address before the action this check belongs to
 */
async function run_check(run, check, url_before, on_wait) {
    const timeout = to_number(check.timeout_ms, DEFAULT_TIMEOUT);
    switch (check.kind) {
    case 'loaded':
        return wait_loaded(run, timeout, on_wait);
    case 'url_changed':
        return wait_until(run, timeout, function () {
            return location.href !== url_before;
        }, on_wait);
    case 'url_matches':
        return wait_until(run, timeout, function () {
            return glob_test(check.value, location.href);
        }, on_wait);
    case 'online':
        return wait_online(run, timeout, on_wait);
    case 'wait':
        return (await sleep(run, to_number(check.value, 0), on_wait)) ? 'ok' : 'stopped';
    default:
        return 'ok';
    }
}

/*
 * check_now(check, url_before) -> true if the check already holds (for the detail view)
 */
function check_now(check, url_before) {
    switch (check.kind) {
    case 'loaded':
        return document.readyState === 'complete';
    case 'url_changed':
        return location.href !== url_before;
    case 'url_matches':
        return glob_test(check.value, location.href);
    case 'online':
        return net.online === true;
    default:
        return true;
    }
}
