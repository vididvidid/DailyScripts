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
 * struct run {
 *     activity: struct activity;
 *     stopped: boolean;        set by stop_run(); every wait notices within 100 ms
 *     step: number;            index of the step being played
 *     loop: number;            loop number, from 0
 *     phase: 'before' | 'action' | 'after' | 'pause' | 'done' | 'failed' | 'stopped';
 *     text: string;            what it is doing, for the panel
 *     left_ms: number;         time left in the current wait, or 0
 *     last_url: string;        URL before the previous action ("before: URL changed")
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
 * play_step(run, step, resume) -> true to go on; resume: the saved run when this step's
 * action already happened on the previous page
 */
async function play_step(run, step, resume) {
    const title = step_title(step, run.step);
    let url_before = location.href;
    if (resume !== null) {
        url_before = resume.url_before;
    } else {
        if (!(await run_checks(run, step.before, run.last_url, 'before'))) {
            return false;
        }
        url_before = location.href;
        for (let r = 0; r < Math.max(1, step.repeat); r++) {
            await save_run_state({ activity_id: run.activity.id, step: run.step, loop: run.loop, phase: 'after', url_before: url_before });
            const times = step.repeat > 1 ? ` (${r + 1} of ${step.repeat})` : '';
            set_phase(run, 'action', `${title}: ${describe_action(step)}${times}`);
            await do_action(run, step);
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
 * start_run(activity, opts) -> Promise<struct run> once it ends;
 *   opts: { step, loop, resume: struct saved_run | null }
 */
async function start_run(activity, opts) {
    const o = opts || {};
    if (current_run !== null && !current_run.stopped && current_run.phase !== 'done') {
        stop_run();
    }
    const run = {
        activity: clone(activity), stopped: false, step: o.step || 0, loop: o.loop || 0,
        phase: 'before', text: 'Starting…', left_ms: 0, last_url: location.href, error: '',
    };
    current_run = run;
    notify(run);
    try {
        await play(run, o.resume || null);
    } catch (e) {
        run.error = `${step_title(run.activity.steps[run.step] || {}, run.step)}: ${e.message}`;
    }
    await save_run_state(null);
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
 * test_step(step) -> Promise; does one step's action right now, without its checks
 */
async function test_step(step) {
    await do_action(null, step);
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
    return start_run(activity, { step: saved.step, loop: saved.loop, resume: saved });
}
