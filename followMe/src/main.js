'use strict';
/*
 * Starting followMe on a page: the edge tab, the panel if it was left open, the
 * Alt+Shift+P shortcut, Esc to stop a run, the menu command, keeping the panel in step
 * with other tabs, watching the internet connection, carrying on a run that a page
 * load interrupted, and playing an activity another tab opened this page for.
 */

/*
 * on_key(event) — Alt+Shift+P opens / closes the panel; Esc stops a playing run
 */
function on_key(event) {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyP') {
        event.preventDefault();
        panel_toggle();
        return;
    }
    if (event.key === 'Escape' && is_running()) {
        stop_run();
        toast('followMe stopped');
    }
}

/*
 * main() — start followMe on this page
 */
async function main() {
    panel.prefs = load_prefs();
    on_run_change(render_status);
    on_online_change(render_net);
    on_gist_change(render_cloud);
    watch_network();
    watch_focus();
    check_online(true);
    await device_now();
    document.addEventListener('keydown', on_key, true);
    GM_registerMenuCommand('followMe: open / close the panel', panel_toggle);
    GM_registerMenuCommand('followMe: stop playing', stop_run);
    GM_addValueChangeListener(ACTIVITIES_KEY, function (key, old_value, new_value, remote) {
        if (remote && panel_visible()) {
            panel_render(); // changed in another tab
        }
    });
    const last = panel.prefs.last_activity ? load_activity(panel.prefs.last_activity) : null;
    if (last !== null && activity_runs_on(last, location.href)) {
        panel.activity = last;
        panel.view = 'detail';
    }
    if (panel.prefs.pinned) {
        side_start();
    }
    tab_render();
    if (panel.prefs.open) {
        panel_render();
    }
    gist_sync_on_start().then(function (r) {
        if (r !== null && r.pulled > 0 && panel_visible()) {
            panel_render(); // the gist had newer activities
        }
    });
    let ran = await resume_saved_run();
    if (ran === null) {
        ran = await start_job();
    }
    if (ran !== null && ran.error !== '') {
        toast(ran.error, { type: 'error' });
    }
}

main();
