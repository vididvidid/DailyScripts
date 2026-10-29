'use strict';
/*
 * Small helpers every other file uses. followMe is built by concatenating src/ in the
 * order tools/build.mjs lists, like linking C translation units: each file declares
 * plain functions and constants, and later files call earlier ones.
 */

const FM_PREFIX = 'fm';   // ids, CSS classes and storage keys start with this

let id_counter = 0;

/*
 * new_id(kind) -> a fresh id such as "fm-step-l2k9x-3"
 */
function new_id(kind) {
    id_counter++;
    return `${FM_PREFIX}-${kind}-${Date.now().toString(36)}-${id_counter}`;
}

/*
 * clone(value) -> a deep copy of plain JSON data
 */
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/*
 * clamp(n, lo, hi) -> n kept between lo and hi
 */
function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

/*
 * to_number(value, fallback) -> value as a finite number, or fallback
 */
function to_number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/*
 * site_of(url) -> "https://example.com" for any URL on that site
 */
function site_of(url) {
    try {
        return new URL(url).origin;
    } catch (e) {
        return '';
    }
}

/*
 * pause(ms) -> Promise resolved after ms
 */
function pause(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, Math.max(0, ms));
    });
}

/*
 * sleep(run, ms, on_tick) -> Promise<boolean>: waits ms in short slices so a stopped
 * run wakes at once; false when the run was stopped. on_tick(left_ms) reports progress.
 */
async function sleep(run, ms, on_tick) {
    const end = Date.now() + Math.max(0, ms);
    while (Date.now() < end) {
        if (run !== null && run.stopped) {
            return false;
        }
        if (on_tick) {
            on_tick(end - Date.now());
        }
        await pause(Math.min(100, end - Date.now()));
    }
    return run === null || !run.stopped;
}

/*
 * with_jitter(ms, jitter) -> ms moved up or down by a random amount up to jitter
 */
function with_jitter(ms, jitter) {
    if (!jitter) {
        return ms;
    }
    return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * jitter));
}

/*
 * format_ms(ms) -> "800 ms", "2.5 s", "1 min 30 s"
 */
function format_ms(ms) {
    if (ms < 1000) {
        return `${Math.round(ms)} ms`;
    }
    if (ms < 60000) {
        return `${Math.round(ms / 100) / 10} s`;
    }
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return sec === 0 ? `${min} min` : `${min} min ${sec} s`;
}

/*
 * glob_test(pattern, text) -> true if text matches a "*" glob or a /regex/
 */
function glob_test(pattern, text) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    try {
        if (re !== null) {
            return new RegExp(re[1], re[2].replace('g', '')).test(text);
        }
        const parts = pattern.split('*');
        for (let i = 0; i < parts.length; i++) {
            parts[i] = parts[i].replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
        }
        return new RegExp(`^${parts.join('.*')}$`).test(text);
    } catch (e) {
        return false;
    }
}
