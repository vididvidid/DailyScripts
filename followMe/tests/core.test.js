'use strict';
/*
 * Tests for followMe's core: the step model, storage, the checks and the runner. The
 * core files are joined like the build joins them and run in a VM with a fake page
 * (location, document, GM_* storage), so no browser is needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ORDER, bundle } from '../tools/build.mjs';

const ROOT = new URL('../', import.meta.url);
const CORE = ['src/core/util.js', 'src/core/steps.js', 'src/core/store.js', 'src/core/checks.js', 'src/core/clicker.js', 'src/core/runner.js'];

/*
 * read(path) -> text of a repo file
 */
function read(path) {
    return readFileSync(new URL(path, ROOT), 'utf8');
}

/*
 * page_create(url) -> a VM context holding the core with a fake page and GM storage;
 *   ctx.values is the GM value store, ctx.tab the GM tab store, ctx.done the actions run
 */
function page_create(url) {
    const values = {};
    const tab = {};
    const ctx = vm.createContext({
        console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, URL: URL, JSON: JSON, Math: Math, Date: Date,
        location: { href: url },
        document: { readyState: 'complete', documentElement: {} },
        performance: { getEntriesByType: function () { return []; } },
        MutationObserver: function () {
            return { observe: function () {}, disconnect: function () {} };
        },
        window: { scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 800 },
        GM_getValue: function (key, fallback) {
            return key in values ? JSON.parse(values[key]) : fallback;
        },
        GM_setValue: function (key, value) {
            values[key] = JSON.stringify(value);
        },
        GM_getTab: function (fn) {
            fn(JSON.parse(JSON.stringify(tab)));
        },
        GM_saveTab: function (obj) {
            for (const key of Object.keys(tab)) {
                delete tab[key];
            }
            Object.assign(tab, JSON.parse(JSON.stringify(obj)));
        },
    });
    let code = '';
    for (const path of CORE) {
        code += `${read(path)}\n`;
    }
    // Expose the script's top-level bindings, and record actions instead of clicking.
    code += 'globalThis.fm = { activity_create, step_create, check_create, step_point, step_title, describe_action, describe_check, '
        + 'activity_runs_on, activity_duration, save_activity, load_activity, activities_for, export_activities, import_activities, '
        + 'run_check, start_run, stop_run, resume_saved_run, load_run_state, glob_test, format_ms };\n'
        + 'globalThis.done = [];\n'
        + 'do_action = async function (run, step) { globalThis.done.push(step.label); if (globalThis.on_action) { globalThis.on_action(step); } };\n';
    vm.runInContext(code, ctx);
    ctx.values = values;
    ctx.tab = tab;
    return ctx;
}

/*
 * quick_step(ctx, label) -> a click step with no pause, for runner tests
 */
function quick_step(ctx, label) {
    const step = ctx.fm.step_create(10, 20, { scroll_x: 0, scroll_y: 0, w: 1000, h: 800 });
    step.label = label;
    step.pause_ms = 0;
    return step;
}

test('a step\'s point follows the screen, the page or the window size', function () {
    const ctx = page_create('https://shop.test/');
    const step = ctx.fm.step_create(100, 200, { scroll_x: 0, scroll_y: 500, w: 1000, h: 800 });
    const now = { scroll_x: 0, scroll_y: 300, w: 500, h: 400 };
    assert.deepEqual({ ...ctx.fm.step_point(step, now) }, { x: 100, y: 200 }, 'screen: same pixel');
    step.place = 'page';
    assert.deepEqual({ ...ctx.fm.step_point(step, now) }, { x: 100, y: 400 }, 'page: moves with the scroll');
    step.place = 'scaled';
    assert.deepEqual({ ...ctx.fm.step_point(step, now) }, { x: 50, y: 100 }, 'scaled: same share of the window');
    assert.equal(ctx.fm.step_title(step, 2), 'Click 3');
    assert.equal(ctx.fm.describe_action(step), 'left click at (100, 200)');
    assert.equal(ctx.fm.describe_check(ctx.fm.check_create('loaded')), 'the page has fully loaded (up to 30 s, then stop)');
    assert.equal(ctx.fm.format_ms(90000), '1 min 30 s');
});

test('activities are stored per site and travel as JSON', function () {
    const ctx = page_create('https://shop.test/cart');
    const a = ctx.fm.activity_create('Checkout', 'https://shop.test/cart');
    a.steps.push(quick_step(ctx, 'one'));
    ctx.fm.save_activity(a);
    ctx.fm.save_activity(ctx.fm.activity_create('Elsewhere', 'https://other.test/'));
    const here = ctx.fm.activities_for('https://shop.test/account');
    assert.equal(here.length, 1);
    assert.equal(here[0].name, 'Checkout');
    assert.ok(ctx.fm.activity_runs_on(a, 'https://shop.test/x/y'));
    assert.ok(!ctx.fm.activity_runs_on(a, 'https://shop.test.evil.example/'));
    assert.equal(ctx.fm.import_activities(ctx.fm.export_activities(here)), 1);
    assert.equal(ctx.fm.activities_for('https://shop.test/').length, 2, 'imported as a copy with a new id');
    assert.ok(ctx.fm.glob_test('/cart\\/\\d+/', 'https://shop.test/cart/42'));
});

test('checks: URL changed / matches, page loaded, and timeouts', async function () {
    const ctx = page_create('https://app.test/a');
    const run = { stopped: false };
    setTimeout(function () {
        ctx.location.href = 'https://app.test/b';
    }, 150);
    const changed = ctx.fm.check_create('url_changed');
    assert.equal(await ctx.fm.run_check(run, changed, 'https://app.test/a', null), 'ok');
    const match = ctx.fm.check_create('url_matches');
    match.value = '*/c';
    match.timeout_ms = 250;
    assert.equal(await ctx.fm.run_check(run, match, '', null), 'timeout');
    assert.equal(await ctx.fm.run_check(run, ctx.fm.check_create('loaded'), '', null), 'ok');
    ctx.document.readyState = 'loading';
    const loaded = ctx.fm.check_create('loaded');
    loaded.timeout_ms = 200;
    assert.equal(await ctx.fm.run_check(run, loaded, '', null), 'timeout');
    run.stopped = true;
    assert.equal(await ctx.fm.run_check(run, ctx.fm.check_create('wait'), '', null), 'stopped');
});

test('runner: steps in order, repeats, loops, disabled steps skipped', async function () {
    const ctx = page_create('https://app.test/');
    const a = ctx.fm.activity_create('Loop', 'https://app.test/');
    const one = quick_step(ctx, 'one');
    one.repeat = 2;
    one.repeat_pause_ms = 0;
    const off = quick_step(ctx, 'off');
    off.enabled = false;
    a.steps = [one, off, quick_step(ctx, 'two')];
    a.loops = 2;
    a.loop_pause_ms = 0;
    const run = await ctx.fm.start_run(a, {});
    assert.equal(run.phase, 'done');
    assert.deepEqual([...ctx.done], ['one', 'one', 'two', 'one', 'one', 'two']);
    assert.equal(ctx.tab.fm_run, undefined, 'nothing left to resume');
});

test('runner: a check that times out stops the run with a clear message', async function () {
    const ctx = page_create('https://app.test/');
    const a = ctx.fm.activity_create('Wait', 'https://app.test/');
    const step = quick_step(ctx, 'go');
    const check = ctx.fm.check_create('url_changed');
    check.timeout_ms = 200;
    step.after.push(check);
    a.steps = [step, quick_step(ctx, 'never')];
    const run = await ctx.fm.start_run(a, {});
    assert.equal(run.phase, 'failed');
    assert.match(run.error, /go: gave up waiting until the URL has changed/);
    assert.deepEqual([...ctx.done], ['go']);
    check.on_timeout = 'continue';
    ctx.done.length = 0;
    assert.equal((await ctx.fm.start_run(a, {})).phase, 'done');
    assert.deepEqual([...ctx.done], ['go', 'never']);
});

test('runner: a click that loads a new page carries on there', async function () {
    const ctx = page_create('https://app.test/login');
    const a = ctx.fm.activity_create('Login', 'https://app.test/');
    const submit = quick_step(ctx, 'submit');
    submit.after.push(ctx.fm.check_create('url_changed'));
    a.steps = [submit, quick_step(ctx, 'next')];
    ctx.fm.save_activity(a);
    // The page goes away during the action: the run never gets further on this page.
    ctx.on_action = function () {
        throw new Error('page unloaded');
    };
    await ctx.fm.start_run(a, {});
    assert.equal(ctx.tab.fm_run, undefined, 'a failed run is not resumed');

    // Simulate the unload properly: keep the saved state as it was at the action.
    ctx.on_action = null;
    ctx.done.length = 0;
    const saved_tab = {};
    ctx.on_action = function () {
        Object.assign(saved_tab, JSON.parse(JSON.stringify(ctx.tab)));
    };
    await ctx.fm.start_run(a, {});
    assert.equal(saved_tab.fm_run.step, 0);
    assert.equal(saved_tab.fm_run.url_before, 'https://app.test/login');

    // The new page: same tab storage, new URL, a fresh copy of the script.
    const next = page_create('https://app.test/home');
    Object.assign(next.values, ctx.values);
    Object.assign(next.tab, saved_tab);
    const resumed = await next.fm.resume_saved_run();
    assert.equal(resumed.phase, 'done');
    assert.deepEqual([...next.done], ['next'], 'the submit click is not repeated; "URL changed" already holds');
});

test('build: followMe.moss is the header plus every source file, and up to date', function () {
    const text = bundle();
    assert.ok(text.startsWith('// ==Moss==\n'));
    for (const path of ORDER) {
        assert.ok(text.includes(`// ---------- ${path} ----------`), path);
    }
    assert.equal(read('followMe.moss'), text, 'run "npm run build"');
    new vm.Script(`(async function () {\n${text}\n})`); // parses as a Moss script body
});
