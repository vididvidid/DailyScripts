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
 * Tab value (GM_getTab): { fm_run: struct saved_run | undefined }
 *
 * struct prefs {
 *     open: boolean;          panel open
 *     side: 'right' | 'left';
 *     show_marks: boolean;    numbered marks on the page while an activity is open
 *     tab_y: number;          where the edge tab sits, 0..1 of the window height
 * }
 *
 * struct saved_run {
 *     activity_id: string;
 *     step: number;           step being played when the page went away
 *     loop: number;           loop number, from 0
 *     phase: 'after';         the action ran; its "after" checks are next
 *     url_before: string;     URL just before the action (for "URL changed")
 *     at: number;             when it was saved; old ones are ignored
 * }
 */

const ACTIVITIES_KEY = 'fm_activities';
const PREFS_KEY = 'fm_prefs';
const RUN_KEY = 'fm_run';
const RESUME_WINDOW_MS = 120000;   // a saved run older than this is not resumed

/*
 * prefs_default() -> struct prefs
 */
function prefs_default() {
    return { open: false, side: 'right', show_marks: true, tab_y: 0.4 };
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
    return all !== null && typeof all === 'object' ? all : {};
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
