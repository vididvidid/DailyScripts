'use strict';
/*
 * Where activities live: one GM value holding every activity of every site, so the
 * panel can list a site's activities and other tabs see changes at once. A run that
 * a page load interrupts is kept per tab (GM_saveTab), so it carries on in that tab
 * only.
 *
 * GM values:
 *     fm_activities  { [id]: struct activity }
 *     fm_prefs       struct prefs
 *     fm_jobs        { [job id]: struct job_result }   answers of activities played on another site
 * Tab value (GM_getTab): { fm_run: struct saved_run | undefined }
 *
 * struct prefs {
 *     open: boolean;          panel open
 *     side: 'right' | 'left';
 *     show_marks: boolean;    numbered marks on the page while an activity is open
 *     tab_y: number;          where the edge tab sits, 0..1 of the window height
 *     last_activity: string;  activity open in the panel, reopened after a reload
 *     online_url: string;     page asked to tell whether the internet is on
 *     pinned: boolean;        the panel lives in Chrome's side panel
 * }
 *
 * struct saved_run {
 *     activity_id: string;
 *     step: number;           step being played when the page went away
 *     loop: number;           loop number, from 0
 *     phase: 'after' | 'start';   'after': the action ran, its "after" checks are next;
 *                             'start': the tab was switched to another device, play the step
 *     url_before: string;     URL just before the action (for "URL changed")
 *     vars: object;           values read so far
 *     job: struct job | null; set when this run plays for an activity on another site
 *     at: number;             when it was saved; old ones are ignored
 * }
 */

const ACTIVITIES_KEY = 'fm_activities';
const PREFS_KEY = 'fm_prefs';
const RUN_KEY = 'fm_run';
const JOBS_KEY = 'fm_jobs';
const RESUME_WINDOW_MS = 120000;   // a saved run older than this is not resumed

/*
 * prefs_default() -> struct prefs
 */
function prefs_default() {
    return { open: false, side: 'right', show_marks: true, tab_y: 0.4, last_activity: '', online_url: ONLINE_URL, pinned: false };
}

/*
 * load_prefs() -> struct prefs
 */
function load_prefs() {
    return Object.assign(prefs_default(), GM_getValue(PREFS_KEY, {}));
}

/*
 * save_prefs(prefs) — remember the panel's state
 */
function save_prefs(prefs) {
    GM_setValue(PREFS_KEY, prefs);
}

/*
 * load_all() -> { [id]: struct activity }
 */
function load_all() {
    const all = GM_getValue(ACTIVITIES_KEY, {});
    if (all === null || typeof all !== 'object') {
        return {};
    }
    for (const id of Object.keys(all)) {
        all[id] = activity_fix(all[id]);
    }
    return all;
}

/*
 * load_activity(id) -> struct activity or null
 */
function load_activity(id) {
    const all = load_all();
    return all[id] === undefined ? null : all[id];
}

/*
 * activities_for(url) -> the activities meant for that page, newest first
 */
function activities_for(url) {
    const all = load_all();
    const out = [];
    for (const id of Object.keys(all)) {
        if (activity_runs_on(all[id], url) || all[id].site === site_of(url)) {
            out.push(all[id]);
        }
    }
    out.sort(function (a, b) {
        return b.updated_at - a.updated_at;
    });
    return out;
}

/*
 * save_activity(activity) -> the stored copy (updated_at refreshed)
 */
function save_activity(activity) {
    const all = load_all();
    const copy = clone(activity);
    copy.updated_at = Date.now();
    all[copy.id] = copy;
    GM_setValue(ACTIVITIES_KEY, all);
    return copy;
}

/*
 * remove_activity(id) — forget an activity
 */
function remove_activity(id) {
    const all = load_all();
    delete all[id];
    GM_setValue(ACTIVITIES_KEY, all);
    mark_deleted(id);
}

/*
 * export_activities(list) -> JSON text for sharing or backup
 */
function export_activities(list) {
    return JSON.stringify({ followme: 1, exported_at: new Date().toISOString(), activities: list }, null, 2);
}

/*
 * import_activities(text) -> how many activities were added (each gets a new id)
 */
function import_activities(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.activities;
    if (!Array.isArray(list)) {
        throw new Error('No activities in that text.');
    }
    let count = 0;
    for (const item of list) {
        if (!item || !Array.isArray(item.steps)) {
            continue;
        }
        const copy = Object.assign(activity_create(item.name || 'Imported', item.site || location.href), item);
        copy.id = new_id('act');
        save_activity(copy);
        count++;
    }
    return count;
}

/*
 * save_run_state(state) -> Promise; state null forgets it
 */
function save_run_state(state) {
    return new Promise(function (resolve) {
        GM_getTab(function (tab) {
            const next = Object.assign({}, tab || {});
            if (state === null) {
                delete next[RUN_KEY];
            } else {
                next[RUN_KEY] = Object.assign({ at: Date.now() }, state);
            }
            GM_saveTab(next);
            resolve();
        });
    });
}

/*
 * load_run_state() -> Promise<struct saved_run | null>, only a recent one
 */
function load_run_state() {
    return new Promise(function (resolve) {
        GM_getTab(function (tab) {
            const state = tab ? tab[RUN_KEY] : undefined;
            if (!state || Date.now() - state.at > RESUME_WINDOW_MS) {
                resolve(null);
                return;
            }
            resolve(state);
        });
    });
}

/*
 * struct job { id: string; activity_id: string; opener: string }   opener: the activity that asked
 * struct job_result { status: 'running' | 'done' | 'failed' | 'stopped'; vars: object; error: string; at: number }
 */

/*
 * load_job(id) -> struct job_result or null
 */
function load_job(id) {
    const jobs = GM_getValue(JOBS_KEY, {});
    return jobs !== null && typeof jobs === 'object' && jobs[id] !== undefined ? jobs[id] : null;
}

/*
 * save_job(id, result) — store a job's result; null forgets it. Results older than a
 * day are dropped on the way.
 */
function save_job(id, result) {
    const old = GM_getValue(JOBS_KEY, {});
    const jobs = {};
    for (const key of Object.keys(old || {})) {
        if (Date.now() - old[key].at < 86400000) {
            jobs[key] = old[key];
        }
    }
    if (result === null) {
        delete jobs[id];
    } else {
        jobs[id] = Object.assign({ vars: {}, error: '' }, result, { at: Date.now() });
    }
    GM_setValue(JOBS_KEY, jobs);
}

/*
 * all_activities() -> every stored activity, of every site, by name
 */
function all_activities() {
    const all = load_all();
    const out = [];
    for (const id of Object.keys(all)) {
        out.push(all[id]);
    }
    out.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });
    return out;
}
