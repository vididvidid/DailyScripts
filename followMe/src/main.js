'use strict';
/*
 * Starting followMe on a page: the edge tab, the panel if it was left open, the
 * Alt+Shift+P shortcut, Esc to stop a run, the menu command, keeping the panel in step
 * with other tabs, and carrying on a run that a page load interrupted.
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
    document.addEventListener('keydown', on_key, true);
    GM_registerMenuCommand('followMe: open / close the panel', panel_toggle);
    GM_registerMenuCommand('followMe: stop playing', stop_run);
    GM_addValueChangeListener(ACTIVITIES_KEY, function (key, old_value, new_value, remote) {
        if (remote && panel.prefs.open) {
            panel_render(); // changed in another tab
        }
    });
    tab_render();
    if (panel.prefs.open) {
        panel_render();
    }
    const resumed = await resume_saved_run();
    if (resumed !== null && resumed.error !== '') {
        toast(resumed.error, { type: 'error' });
    }
}

main();
