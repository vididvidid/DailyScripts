'use strict';
/*
 * Playing an activity: for each step, wait for its "before" checks, do the action
 * (repeat times), wait for its "after" checks, then take the step's pause. Loops as
 * often as the activity says. Only one run at a time per tab.
 *
 * A click that loads a new page ends this script, so just before every action the run
 * is saved for this tab. When followMe starts on the next page it finds that and
 * carries on with the step's "after" checks ("URL changed" is then already true).
 *
 * Before the first step the tab is switched to the activity's device (mobile, tablet,
 * desktop) if it isn't shown that way yet; that reloads the page, and the run starts
 * again from the saved state. Before every step, an activity that needs the internet
 * checks it is on, and waits for it (or stops) when it is not.
 *
 * An "other site" step opens a page beside this one with GM_split, and followMe there
 * finds the job in GM_split.data(), plays the activity, and puts what it read in
 * fm_jobs; this side waits for that, takes the values, and closes the page.
 *
 * struct run {
 *     activity: struct activity;
 *     stopped: boolean;        set by stop_run(); every wait notices within 100 ms
 *     step: number;            index of the step being played
 *     loop: number;            loop number, from 0
 *     phase: 'before' | 'action' | 'after' | 'pause' | 'done' | 'failed' | 'stopped';
 *     text: string;            what it is doing, for the panel
 *     left_ms: number;         time left in the current wait, or 0
 *     last_url: string;        URL before the previous action ("before: URL changed")
 *     vars: object;            values read so far ({name} in texts and URLs)
 *     job: struct job | null;  this run plays for an activity on another site
 *     side_id: number | null;  page opened beside this one by the step playing now
 *     switched: boolean;       the page was just reloaded to switch the device
 *     error: string;
 * }
 */

let current_run = null;
const run_listeners = [];

/*
 * on_run_change(fn) — fn(run) is called whenever the current run changes
 */
function on_run_change(fn) {
    run_listeners.push(fn);
}

/*
 * notify(run) — tell the panel and the marks
 */
function notify(run) {
    for (const fn of run_listeners) {
        try {
            fn(run);
        } catch (e) {
            console.error('followMe:', e);
        }
    }
}

/*
 * set_phase(run, phase, text) — update what the run is doing
 */
function set_phase(run, phase, text) {
    run.phase = phase;
    run.text = text;
    run.left_ms = 0;
    notify(run);
}

/*
 * ticker(run) -> an on_wait callback that shows the time left (at most ~5 times a second)
 */
function ticker(run) {
    let last = 0;
    return function (left_ms) {
        if (Date.now() - last < 200) {
            return;
        }
        last = Date.now();
        run.left_ms = left_ms;
        notify(run);
    };
}

/*
 * run_checks(run, checks, url_before, when) -> true to go on, false to end the run
 */
async function run_checks(run, checks, url_before, when) {
    for (const check of checks) {
        set_phase(run, when, `${step_title(run.activity.steps[run.step], run.step)}: waiting until ${describe_check(check)}`);
        const result = await run_check(run, check, url_before, ticker(run));
        if (result === 'stopped') {
            return false;
        }
        if (result === 'timeout' && check.on_timeout === 'stop') {
            run.error = `${step_title(run.activity.steps[run.step], run.step)}: gave up waiting until ${describe_check(check)}.`;
            return false;
        }
    }
    return true;
}

/*
 * saved(run, extra) -> struct saved_run for this run, with extra fields
 */
function saved(run, extra) {
    return Object.assign({ activity_id: run.activity.id, step: run.step, loop: run.loop, vars: run.vars, job: run.job }, extra);
}

/*
 * gate_online(run) -> true to go on: the internet is on, or came back while waiting
 */
async function gate_online(run) {
    if (!run.activity.need_online || (await check_online(false))) {
        return true;
    }
    if (run.activity.offline === 'stop') {
        run.error = 'No internet connection, so it stopped.';
        return false;
    }
    set_phase(run, 'before', 'No internet connection — waiting for it to come back');
    const result = await wait_online(run, 0, ticker(run));
    if (result !== 'ok') {
        return false;
    }
    toast('Internet is back — carrying on');
    return true;
}

/*
 * ensure_device(run) -> 'ok', or 'reloading' when the tab is being switched to the
 *   activity's device (the run carries on after the reload)
 */
async function ensure_device(run) {
    const a = run.activity;
    const state = await device_now();
    if (device_matches(state, a.device, a.orientation)) {
        return 'ok';
    }
    if (a.device === 'desktop' && !device_supported()) {
        return 'ok';
    }
    if (run.switched) {
        throw new Error(`The tab could not be shown as ${DEVICES[a.device] || a.device} (was Chrome's debugging bar cancelled?).`);
    }
    await save_run_state(saved(run, { phase: 'start', url_before: location.href }));
    set_phase(run, 'action', `Showing the page as ${DEVICES[a.device] || a.device} — it reloads`);
    await device_switch(a.device, a.orientation);
    return 'reloading';
}

/*
 * side_wait(run, step, opened, job_id) -> struct job_result, or null when the run was
 *   stopped; throws when the other page closed or took too long
 */
async function side_wait(run, step, opened, job_id) {
    const end = Date.now() + to_number(step.side_timeout_ms, 120000);
    let last_look = 0;
    while (true) {
        if (run.stopped) {
            return null;
        }
        const result = load_job(job_id);
        if (result !== null && result.status !== 'running') {
            return result;
        }
        if (Date.now() >= end) {
            throw new Error(`"${side_name(step)}" didn't finish within ${format_ms(step.side_timeout_ms)}.`);
        }
        if (Date.now() - last_look > 1000) {
            last_look = Date.now();
            if (!(await GM_split.isOpen(opened.id))) {
                throw new Error(`The page of "${side_name(step)}" was closed before it finished.`);
            }
        }
        run.left_ms = end - Date.now();
        notify(run);
        await pause(300);
    }
}

/*
 * play_side(run, step) -> Promise; an "other site" step: open the page beside this one,
 *   let followMe there play the activity, and bring back what it read
 */
async function play_side(run, step) {
    const other = step.side_activity === '' ? null : load_activity(step.side_activity);
    if (other === null) {
        throw new Error('Pick the activity to play on the other site.');
    }
    if (typeof GM_split === 'undefined') {
        throw new Error('Running on another site needs a Moss with GM_split (Moss 0.2+).');
    }
    const url = fill_vars(step.side_url !== '' ? step.side_url : other.start_url, run.vars);
    const job_id = new_id('job');
    save_job(job_id, { status: 'running' });
    const opts = { side: step.side_place, data: { followme_job: { id: job_id, activity_id: other.id, opener: run.activity.name, vars: run.vars } } };
    if (step.side_how !== 'auto') {
        opts.how = step.side_how;
    }
    const opened = await GM_split.open(url, opts);
    run.side_id = opened.id;
    let result = null;
    try {
        result = await side_wait(run, step, opened, job_id);
    } finally {
        run.side_id = null;
        save_job(job_id, null);
        if (step.side_close || result === null) {
            await GM_split.close(opened.id).catch(function () {});
        }
    }
    if (result === null) {
        return;
    }
    Object.assign(run.vars, result.vars || {});
    if (result.status !== 'done') {
        throw new Error(`On ${side_target(step)}: ${result.error || result.status}`);
    }
}

/*
 * perform(run, step) -> Promise; the step's action once, keeping what a 'read' step read
 */
async function perform(run, step) {
    if (step.action === 'side') {
        await play_side(run, step);
        return;
    }
    const value = await do_action(run, step);
    if (step.action === 'read') {
        run.vars[step.var_name || 'answer'] = value;
    }
}

/*
 * play_step(run, step, resume) -> true to go on; resume: the saved run when this step's
 * action already happened on the previous page
 */
async function play_step(run, step, resume) {
    const title = step_title(step, run.step);
    let url_before = location.href;
    if (resume !== null) {
        url_before = resume.url_before;
    } else {
        if (!(await gate_online(run))) {
            return false;
        }
        if (!(await run_checks(run, step.before, run.last_url, 'before'))) {
            return false;
        }
        url_before = location.href;
        for (let r = 0; r < Math.max(1, step.repeat); r++) {
            await save_run_state(saved(run, { phase: 'after', url_before: url_before }));
            const times = step.repeat > 1 ? ` (${r + 1} of ${step.repeat})` : '';
            set_phase(run, 'action', `${title}: ${describe_action(step)}${times}`);
            await perform(run, step);
            if (run.stopped) {
                return false;
            }
            if (r < step.repeat - 1 && !(await sleep(run, with_jitter(step.repeat_pause_ms, step.jitter_ms), ticker(run)))) {
                return false;
            }
        }
    }
    if (!(await run_checks(run, step.after, url_before, 'after'))) {
        return false;
    }
    run.last_url = url_before;
    return true;
}

/*
 * is_last(run, index) -> true if index is the last enabled step of the last loop
 */
function is_last(run, index) {
    const steps = run.activity.steps;
    for (let i = index + 1; i < steps.length; i++) {
        if (steps[i].enabled) {
            return false;
        }
    }
    return run.activity.loops !== 0 && run.loop >= run.activity.loops - 1;
}

/*
 * play(run, resume) -> Promise; the whole run, from run.step / run.loop
 */
async function play(run, resume) {
    const steps = run.activity.steps;
    let pending = resume;
    while (run.activity.loops === 0 || run.loop < run.activity.loops) {
        for (; run.step < steps.length; run.step++) {
            const step = steps[run.step];
            if (!step.enabled) {
                continue;
            }
            if (!(await play_step(run, step, pending))) {
                return;
            }
            pending = null;
            if (!is_last(run, run.step)) {
                set_phase(run, 'pause', `${step_title(step, run.step)} done — pausing`);
                if (!(await sleep(run, with_jitter(step.pause_ms, step.jitter_ms), ticker(run)))) {
                    return;
                }
            }
        }
        run.step = 0;
        run.loop++;
        if (run.activity.loops === 0 || run.loop < run.activity.loops) {
            set_phase(run, 'pause', `Loop ${run.loop} done — next loop`);
            if (!(await sleep(run, run.activity.loop_pause_ms, ticker(run)))) {
                return;
            }
        }
    }
}

/*
 * finish_job(run) — tell the activity that opened this page how the run went
 */
function finish_job(run) {
    if (run.job === null) {
        return;
    }
    let status = 'done';
    if (run.error !== '') {
        status = 'failed';
    } else if (run.stopped) {
        status = 'stopped';
    }
    save_job(run.job.id, { status: status, vars: run.vars, error: run.error });
}

/*
 * start_run(activity, opts) -> Promise<struct run> once it ends;
 *   opts: { step, loop, resume: struct saved_run | null, vars, job: struct job | null, switched }
 */
async function start_run(activity, opts) {
    const o = opts || {};
    if (current_run !== null && !current_run.stopped && current_run.phase !== 'done') {
        stop_run();
    }
    const run = {
        activity: clone(activity), stopped: false, step: o.step || 0, loop: o.loop || 0,
        phase: 'before', text: 'Starting…', left_ms: 0, last_url: location.href, error: '',
        vars: Object.assign({}, o.vars || {}), job: o.job || null, side_id: null, switched: !!o.switched,
    };
    current_run = run;
    notify(run);
    try {
        if (o.resume === undefined || o.resume === null) {
            if ((await ensure_device(run)) === 'reloading') {
                return run;
            }
        }
        await play(run, o.resume || null);
    } catch (e) {
        run.error = `${step_title(run.activity.steps[run.step] || {}, run.step)}: ${e.message}`;
    }
    await save_run_state(null);
    finish_job(run);
    if (run.error !== '') {
        set_phase(run, 'failed', run.error);
    } else if (run.stopped) {
        set_phase(run, 'stopped', 'Stopped');
    } else {
        set_phase(run, 'done', `Finished "${run.activity.name}"`);
    }
    return run;
}

/*
 * stop_run() — stop the current run (it notices within 100 ms)
 */
function stop_run() {
    if (current_run !== null) {
        current_run.stopped = true;
        if (current_run.side_id !== null) {
            GM_split.close(current_run.side_id).catch(function () {});
        }
        notify(current_run);
    }
    save_run_state(null);
}

/*
 * is_running() -> true while a run is playing
 */
function is_running() {
    return current_run !== null && !current_run.stopped && ['before', 'action', 'after', 'pause'].indexOf(current_run.phase) >= 0;
}

/*
 * test_step(step, activity) -> Promise of the values the step read; does one step's
 *   action right now, without its checks
 */
async function test_step(step, activity) {
    const run = { activity: activity, stopped: false, vars: {}, side_id: null, left_ms: 0 };
    await perform(run, step);
    return run.vars;
}

/*
 * resume_saved_run() -> Promise; carry on with a run a page load interrupted
 */
async function resume_saved_run() {
    const saved = await load_run_state();
    if (saved === null) {
        return null;
    }
    const activity = load_activity(saved.activity_id);
    if (activity === null || saved.step >= activity.steps.length) {
        await save_run_state(null);
        return null;
    }
    const resume = saved.phase === 'after' ? saved : null;
    return start_run(activity, { step: saved.step, loop: saved.loop, resume: resume, vars: saved.vars, job: saved.job || null, switched: saved.phase === 'start' });
}

/*
 * start_job() -> Promise<struct run | null>; in a page another activity opened beside
 *   itself, play the activity it asked for (once: a reload doesn't start it again)
 */
async function start_job() {
    if (typeof GM_split === 'undefined') {
        return null;
    }
    const info = await GM_split.data();
    const job = info !== null && info.data !== null && typeof info.data === 'object' ? info.data.followme_job : undefined;
    if (job === undefined) {
        return null;
    }
    const result = load_job(job.id);
    if (result === null || result.status !== 'running' || result.started) {
        return null;
    }
    const activity = load_activity(job.activity_id);
    if (activity === null) {
        save_job(job.id, { status: 'failed', error: 'its activity was deleted' });
        return null;
    }
    save_job(job.id, { status: 'running', started: true });
    toast(`followMe: playing "${activity.name}" for "${job.opener}"`);
    return start_run(activity, { vars: job.vars, job: { id: job.id, activity_id: job.activity_id, opener: job.opener } });
}
