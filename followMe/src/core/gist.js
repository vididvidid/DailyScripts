'use strict';
/*
 * Keeping every activity in a private GitHub gist, as a backup and to share them
 * between computers. Each activity is one readable file in the gist
 * ("example.com--checkout--k9x-3.json"), and _followme.json lists deleted ones. The gist
 * keeps every earlier version (its revisions), so any old state can be brought back.
 *
 * A sync reads the gist, merges it with the activities here (per activity the newer one
 * wins; a deletion wins over anything older), stores the result here and writes back
 * whatever changed. It runs when you press Save, add a step, delete or import an
 * activity, and when followMe starts on a page (at most once a minute).
 *
 * GM values:
 *     fm_gist     struct gist_conf
 *     fm_deleted  { [activity id]: when it was deleted }
 *
 * struct gist_conf {
 *     token: string;           GitHub token with the "gist" scope
 *     gist_id: string;
 *     auto: boolean;           sync on save / add / start-up
 *     last_sync: number;       when the last sync finished, 0 = never
 *     error: string;           what went wrong last time, '' = fine
 *     url: string;             the gist's page
 * }
 */

const GIST_KEY = 'fm_gist';
const DELETED_KEY = 'fm_deleted';
const GIST_META = '_followme.json';
const GIST_API = 'https://api.github.com';
const GIST_PULL_EVERY_MS = 60000;      // start-up syncs at most this often
const DELETED_KEEP_MS = 90 * 86400000; // forget deletions after 90 days

const gist = { busy: null, again: false, timer: 0, listeners: [] };

/*
 * gist_conf() -> struct gist_conf
 */
function gist_conf() {
    return Object.assign({ token: '', gist_id: '', auto: true, last_sync: 0, error: '', url: '' }, GM_getValue(GIST_KEY, {}));
}

/*
 * gist_conf_set(change) -> struct gist_conf after merging change into it
 */
function gist_conf_set(change) {
    const conf = Object.assign(gist_conf(), change);
    GM_setValue(GIST_KEY, conf);
    for (const fn of gist.listeners) {
        try {
            fn(conf);
        } catch (e) {
            console.error('followMe:', e);
        }
    }
    return conf;
}

/*
 * on_gist_change(fn) — fn(conf) after every sync or settings change
 */
function on_gist_change(fn) {
    gist.listeners.push(fn);
}

/*
 * gist_ready() -> true when a token and a gist are set
 */
function gist_ready() {
    const conf = gist_conf();
    return conf.token !== '' && conf.gist_id !== '';
}

/*
 * mark_deleted(id) — remember a deletion so the sync removes it everywhere
 */
function mark_deleted(id) {
    const deleted = GM_getValue(DELETED_KEY, {});
    deleted[id] = Date.now();
    GM_setValue(DELETED_KEY, deleted);
}

/*
 * clean_token(text) -> the token alone: no spaces, line breaks or invisible characters
 *   picked up when copying, no "Bearer " / "token " / quotes around it
 */
function clean_token(text) {
    return String(text).replace(/^\s*(bearer|token)\s+/i, '').replace(/[^\x21-\x7e]/g, '').replace(/^["'`]+|["'`]+$/g, '');
}

/*
 * token_shape(token) -> "ghp_ab… (40 characters)": enough to see it is the right one,
 *   not enough to use it
 */
function token_shape(token) {
    return `"${token.slice(0, 6)}…" (${token.length} characters)`;
}

/*
 * token_problem(token) -> why this can't be a GitHub token, or ''
 */
function token_problem(token) {
    if (token === '') {
        return 'Paste a token first.';
    }
    if (/^ghp_[A-Za-z0-9]{36}$/.test(token) || /^github_pat_[A-Za-z0-9_]{60,}$/.test(token) || /^gh[ous]_[A-Za-z0-9]{36,}$/.test(token)) {
        return '';
    }
    if (/^(ghp_|github_pat_)/.test(token)) {
        return `That token looks cut off or changed: ${token_shape(token)}. A classic token is "ghp_" + 36 characters; a fine-grained one "github_pat_" + about 80. Copy it again, whole.`;
    }
    if (/^[0-9a-f]{40}$/.test(token)) {
        return ''; // an old-style classic token
    }
    return `That doesn't look like a GitHub token: ${token_shape(token)}. Tokens start with "ghp_" (classic) or "github_pat_" (fine-grained).`;
}

/*
 * github(token, method, url, body) -> Promise of the parsed JSON answer; throws with
 *   GitHub's message on an error. err.status is the HTTP status; the answer's headers
 *   are on github.last_headers.
 */
function github(token, method, url, body) {
    return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
            method: method,
            url: url.startsWith('https://') ? url : `${GIST_API}${url}`,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            data: body === undefined ? undefined : JSON.stringify(body),
            timeout: 20000,
            anonymous: true,
            onload: function (response) {
                let data = null;
                try {
                    data = response.responseText ? JSON.parse(response.responseText) : null;
                } catch (e) {
                    data = response.responseText;
                }
                github.last_headers = response.responseHeaders || '';
                if (response.status >= 200 && response.status < 300) {
                    resolve(data);
                    return;
                }
                const said = data !== null && data.message ? data.message : `HTTP ${response.status}`;
                let why = `GitHub says "${said}"`;
                if (response.status === 401) {
                    why = `GitHub says "${said}" for the token ${token_shape(token)}: it is not a valid token now. Check it was copied whole, and that it isn't expired or deleted (github.com/settings/tokens).`;
                } else if (response.status === 404) {
                    why = `GitHub says "${said}": the gist doesn't exist, or the token may not use gists (classic: tick "gist"; fine-grained: Account permissions → Gists → Read and write).`;
                } else if (response.status === 403) {
                    why = `GitHub says "${said}" (403): the token may not use gists (fine-grained: Account permissions → Gists → Read and write), or the rate limit was hit.`;
                }
                const err = new Error(why);
                err.status = response.status;
                reject(err);
            },
            onerror: function () {
                reject(new Error('GitHub could not be reached'));
            },
            ontimeout: function () {
                reject(new Error('GitHub did not answer in time'));
            },
        });
    });
}

/*
 * slug(text) -> "my-checkout-flow", safe for a file name
 */
function slug(text) {
    const s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 40) || 'activity';
}

/*
 * gist_file_name(activity) -> "example.com--checkout--k9x-3.json"
 */
function gist_file_name(activity) {
    let host = 'site';
    try {
        host = new URL(activity.site).hostname || 'site';
    } catch (e) {
        host = 'site';
    }
    return `${host}--${slug(activity.name)}--${slug(activity.id.slice(-8))}.json`;
}

/*
 * gist_content(activity) -> the activity as stored in the gist (no local-only fields)
 */
function gist_content(activity) {
    const copy = clone(activity);
    delete copy.unsaved;
    return `${JSON.stringify(copy, null, 2)}\n`;
}

/*
 * meta_content(deleted) -> the text of _followme.json
 */
function meta_content(deleted) {
    return `${JSON.stringify({
        followme: 2,
        about: 'followMe activities (https://github.com/vididvidid/DailyScripts/tree/main/followMe). One file per activity; this file lists deleted ones. Older versions: the gist\'s Revisions.',
        deleted: deleted,
    }, null, 2)}\n`;
}

/*
 * read_gist(conf) -> Promise<{ activities: { [id]: { activity, file, text } }, deleted, meta_text, url }>
 */
async function read_gist(conf) {
    const data = await github(conf.token, 'GET', `/gists/${encodeURIComponent(conf.gist_id)}`);
    const out = { activities: {}, deleted: {}, meta_text: '', url: data.html_url || '' };
    for (const name of Object.keys(data.files || {})) {
        const file = data.files[name];
        let text = file.content || '';
        if (file.truncated && file.raw_url) {
            text = await github(conf.token, 'GET', file.raw_url).then(function (raw) {
                return typeof raw === 'string' ? raw : JSON.stringify(raw);
            });
        }
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            parsed = null;
        }
        if (parsed === null || typeof parsed !== 'object') {
            continue;
        }
        if (name === GIST_META) {
            out.deleted = parsed.deleted || {};
            out.meta_text = text;
        } else if (typeof parsed.id === 'string' && Array.isArray(parsed.steps)) {
            out.activities[parsed.id] = { activity: activity_fix(parsed), file: name, text: text };
        }
    }
    return out;
}

/*
 * merge_deleted(a, b) -> every deletion of both, the later time when both have one;
 *   old ones are dropped
 */
function merge_deleted(a, b) {
    const out = {};
    for (const source of [a, b]) {
        for (const id of Object.keys(source)) {
            if (Date.now() - source[id] < DELETED_KEEP_MS && (out[id] === undefined || source[id] > out[id])) {
                out[id] = source[id];
            }
        }
    }
    return out;
}

/*
 * merge_activities(local, remote, deleted) -> { [id]: struct activity } after the sync:
 *   the newer copy of each, minus the deleted ones
 */
function merge_activities(local, remote, deleted) {
    const out = {};
    const ids = Object.keys(local);
    for (const id of Object.keys(remote)) {
        if (ids.indexOf(id) < 0) {
            ids.push(id);
        }
    }
    for (const id of ids) {
        const mine = local[id];
        const theirs = remote[id] === undefined ? undefined : remote[id].activity;
        let pick = mine;
        if (mine === undefined || (theirs !== undefined && theirs.updated_at > mine.updated_at)) {
            pick = theirs;
            if (mine !== undefined && mine.unsaved) {
                pick = Object.assign({}, theirs, { unsaved: [] });
            }
        }
        if (deleted[id] !== undefined && deleted[id] >= pick.updated_at) {
            continue;
        }
        out[id] = pick;
    }
    return out;
}

/*
 * sync_once() -> Promise<{ pulled, pushed }>: one full sync (read, merge, write back)
 */
async function sync_once() {
    const conf = gist_conf();
    const remote = await read_gist(conf);
    const local = load_all();
    const deleted = merge_deleted(GM_getValue(DELETED_KEY, {}), remote.deleted);
    const merged = merge_activities(local, remote.activities, deleted);

    // Here: take what the gist had newer, drop what was deleted elsewhere.
    let pulled = 0;
    for (const id of Object.keys(merged)) {
        if (local[id] === undefined || merged[id].updated_at !== local[id].updated_at) {
            pulled++;
        }
    }
    for (const id of Object.keys(local)) {
        if (merged[id] === undefined) {
            pulled++;
        }
    }
    if (pulled > 0) {
        GM_setValue(ACTIVITIES_KEY, merged);
    }
    GM_setValue(DELETED_KEY, deleted);

    // There: write the files that differ, remove the ones no longer wanted.
    const files = {};
    let pushed = 0;
    for (const id of Object.keys(merged)) {
        const name = gist_file_name(merged[id]);
        const text = gist_content(merged[id]);
        const old = remote.activities[id];
        if (old !== undefined && old.file !== name) {
            files[old.file] = null;
        }
        if (old === undefined || old.file !== name || old.text !== text) {
            files[name] = { content: text };
            pushed++;
        }
    }
    for (const id of Object.keys(remote.activities)) {
        if (merged[id] === undefined) {
            files[remote.activities[id].file] = null;
            pushed++;
        }
    }
    const meta = meta_content(deleted);
    if (meta !== remote.meta_text) {
        files[GIST_META] = { content: meta };
    }
    if (Object.keys(files).length > 0) {
        await github(conf.token, 'PATCH', `/gists/${encodeURIComponent(conf.gist_id)}`, { files: files });
    }
    gist_conf_set({ last_sync: Date.now(), error: '', url: remote.url });
    return { pulled: pulled, pushed: pushed };
}

/*
 * gist_sync() -> Promise<{ pulled, pushed } | null>; null when no gist is set. Syncs
 *   one at a time: a call during a sync runs once more after it.
 */
function gist_sync() {
    if (!gist_ready()) {
        return Promise.resolve(null);
    }
    if (gist.busy !== null) {
        gist.again = true;
        return gist.busy;
    }
    gist.busy = sync_once().catch(function (e) {
        gist_conf_set({ error: e.message });
        throw e;
    }).finally(function () {
        gist.busy = null;
        if (gist.again) {
            gist.again = false;
            gist_sync().catch(function () {});
        }
    });
    return gist.busy;
}

/*
 * gist_sync_soon() — sync in a moment (adding several steps quickly syncs once)
 */
function gist_sync_soon() {
    if (!gist_ready() || !gist_conf().auto) {
        return;
    }
    clearTimeout(gist.timer);
    gist.timer = setTimeout(function () {
        gist_sync().catch(function (e) {
            console.warn('followMe: gist sync failed:', e.message);
        });
    }, 1500);
}

/*
 * gist_sync_on_start() -> Promise; the start-up sync, at most once a minute
 */
function gist_sync_on_start() {
    const conf = gist_conf();
    if (!gist_ready() || !conf.auto || Date.now() - conf.last_sync < GIST_PULL_EVERY_MS) {
        return Promise.resolve(null);
    }
    return gist_sync().catch(function (e) {
        console.warn('followMe: gist sync failed:', e.message);
        return null;
    });
}

/*
 * gist_connect(token, gist_id) -> Promise<struct gist_conf>: use that gist, or find the
 *   followMe gist of that account, or make a new private one; then sync
 */
async function gist_connect(token_text, gist_id) {
    const token = clean_token(token_text);
    const problem = token_problem(token);
    if (problem !== '') {
        throw new Error(problem);
    }
    // Ask who the token belongs to first: a clear answer before touching any gist.
    const me = await github(token, 'GET', '/user');
    const scopes = /x-oauth-scopes:\s*([^\r\n]*)/i.exec(github.last_headers || '');
    if (scopes !== null && scopes[1].split(/\s*,\s*/).indexOf('gist') < 0) {
        throw new Error(`The token works (it is ${me.login}'s), but it lacks the "gist" scope (it has: ${scopes[1] || 'none'}). Make one with "gist" ticked.`);
    }
    let id = gist_id.trim();
    const match = /([0-9a-f]{20,})\/?$/i.exec(id);
    if (match !== null) {
        id = match[1]; // a pasted gist URL
    }
    if (id === '') {
        const list = await github(token, 'GET', '/gists?per_page=100');
        for (const item of list) {
            if (item.files && item.files[GIST_META] !== undefined) {
                id = item.id;
                break;
            }
        }
    }
    if (id === '') {
        const made = await github(token, 'POST', '/gists', {
            description: 'followMe activities — synced by followMe (Moss)',
            public: false,
            files: { [GIST_META]: { content: meta_content({}) } },
        });
        id = made.id;
    }
    gist_conf_set({ token: token, gist_id: id, error: '', last_sync: 0 });
    await gist_sync();
    return gist_conf();
}

/*
 * gist_disconnect() — stop syncing (the gist itself stays on GitHub)
 */
function gist_disconnect() {
    gist_conf_set({ token: '', gist_id: '', last_sync: 0, error: '', url: '' });
}

/*
 * backup_text() -> every activity as one JSON file, for a download
 */
function backup_text() {
    return export_activities(all_activities());
}
