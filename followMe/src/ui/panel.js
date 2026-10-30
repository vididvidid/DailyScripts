'use strict';
/*
 * The side panel. Two views:
 *   list    — this site's activities: play one, open one, make a new one
 *   detail  — one activity: its steps in order. Each step opens to show where it acts
 *             on the screen (a small map of the window, the pixel, what is there right
 *             now), what it does, how it does it, what it waits for before and after,
 *             and the break before the next step.
 * Plus a third, 'transfer', for exporting and importing activities as JSON.
 *
 * struct panel (one, below) {
 *     layer: struct layer | null;
 *     view: 'list' | 'detail' | 'transfer';
 *     activity: struct activity | null;   the one open in 'detail'
 *     open_step: number;                  step whose details are shown, or -1
 *     prefs: struct prefs;
 *     status: HTMLElement | null;         the run status bar
 *     rows: HTMLElement[];                step rows, to mark the playing one
 *     hidden: boolean;                    hidden while marking a point
 *     net: HTMLElement | null;            the "online / offline" light in the header
 * }
 */

const panel = { layer: null, view: 'list', activity: null, open_step: -1, prefs: null, status: null, rows: [], hidden: false, net: null };

// ---------- opening and closing ----------

/*
 * panel_open() — show the panel
 */
function panel_open() {
    panel.prefs.open = true;
    save_prefs(panel.prefs);
    panel_render();
    tab_render();
}

/*
 * panel_close() — hide the panel (and the marks, unless a run is playing)
 */
function panel_close() {
    panel.prefs.open = false;
    save_prefs(panel.prefs);
    if (panel.layer !== null) {
        layer_remove(panel.layer);
        panel.layer = null;
    }
    if (!is_running()) {
        marks_set(null, -1, null);
    }
    tab_render();
}

/*
 * panel_toggle() — open or close
 */
function panel_toggle() {
    if (panel.prefs.open) {
        panel_close();
    } else {
        panel_open();
    }
}

// ---------- editing the open activity ----------

/*
 * commit(change, rerender) — change the open activity, store it, redraw the marks and,
 * when rerender, the panel
 */
function commit(change, rerender) {
    change(panel.activity);
    panel.activity = save_activity(panel.activity);
    show_marks();
    if (rerender) {
        panel_render();
    }
}

/*
 * edit_step(index, change, rerender) — commit a change to one step
 */
function edit_step(index, change, rerender) {
    commit(function (activity) {
        change(activity.steps[index]);
    }, rerender);
}

/*
 * show_marks() — marks for the open activity, if the user wants them
 */
function show_marks() {
    if (panel.view === 'detail' && panel.activity !== null && panel.prefs.show_marks && !panel.hidden) {
        marks_set(panel.activity, panel.open_step, move_step_to);
    } else if (!is_running()) {
        marks_set(null, -1, null);
    }
}

/*
 * move_step_to(index, x, y) — a mark was dragged: the step now acts there
 */
function move_step_to(index, x, y) {
    const view = view_now();
    edit_step(index, function (step) {
        step.x = Math.round(x);
        step.y = Math.round(y);
        step.scroll_x = Math.round(view.scroll_x);
        step.scroll_y = Math.round(view.scroll_y);
        step.view_w = view.w;
        step.view_h = view.h;
    }, true);
}

/*
 * with_panel_hidden(task) -> Promise of task(); the panel steps aside while you mark a point
 */
async function with_panel_hidden(task) {
    panel.hidden = true;
    if (panel.layer !== null) {
        panel.layer.host.style.display = 'none';
    }
    try {
        return await task();
    } finally {
        panel.hidden = false;
        if (panel.layer !== null) {
            panel.layer.host.style.display = '';
        }
    }
}

/*
 * add_point_step(action) — mark a pixel and add a step there (after the open step, or
 *   last); action: 'click' when left out
 */
async function add_point_step(action) {
    const at = panel.open_step >= 0 ? panel.open_step + 1 : panel.activity.steps.length;
    const point = await with_panel_hidden(function () {
        return pick_point(at + 1);
    });
    if (point === null) {
        show_marks();
        return;
    }
    const step = step_create(point.x, point.y, view_now());
    if (typeof action === 'string') {
        step.action = action;
    }
    commit(function (activity) {
        activity.steps.splice(at, 0, step);
    }, false);
    panel.open_step = at;
    panel_render();
}

/*
 * add_other_step(action) — add a step that needs no point ('wait', 'key' or 'side')
 */
function add_other_step(action) {
    const at = panel.open_step >= 0 ? panel.open_step + 1 : panel.activity.steps.length;
    const step = step_create(0, 0, view_now());
    step.action = action;
    commit(function (activity) {
        activity.steps.splice(at, 0, step);
    }, false);
    panel.open_step = at;
    panel_render();
}

/*
 * remark_step(index) — mark a new pixel for an existing step
 */
async function remark_step(index) {
    const point = await with_panel_hidden(function () {
        return pick_point(index + 1);
    });
    if (point !== null) {
        move_step_to(index, point.x, point.y);
    } else {
        show_marks();
    }
}

/*
 * move_step(index, by) — move a step up (-1) or down (+1)
 */
function move_step(index, by) {
    const to = index + by;
    if (to < 0 || to >= panel.activity.steps.length) {
        return;
    }
    commit(function (activity) {
        const step = activity.steps.splice(index, 1)[0];
        activity.steps.splice(to, 0, step);
    }, false);
    panel.open_step = panel.open_step === index ? to : panel.open_step;
    panel_render();
}

/*
 * open_activity(activity) — show one activity in detail
 */
function open_activity(activity) {
    panel.activity = activity;
    panel.view = 'detail';
    panel.open_step = -1;
    panel.prefs.last_activity = activity.id;
    save_prefs(panel.prefs);
    panel_render();
}

/*
 * close_activity() — back to the list
 */
function close_activity() {
    panel.view = 'list';
    panel.activity = null;
    panel.prefs.last_activity = '';
    save_prefs(panel.prefs);
    panel_render();
}

/*
 * switch_device(mode, orientation) — show this tab as that device now (it reloads)
 */
function switch_device(mode, orientation) {
    device_switch(mode, orientation).catch(function (e) {
        toast(e.message, { type: 'error' });
    });
}

/*
 * new_activity() — ask for a name, create it, and start marking its first click
 */
function new_activity() {
    const name = prompt('Name of the new activity:', `On ${location.hostname}`);
    if (name === null) {
        return;
    }
    open_activity(save_activity(activity_create(name.trim() || 'Untitled', location.href)));
    add_point_step('click');
}

/*
 * play_activity(activity, from) — play an activity from step index from
 */
function play_activity(activity, from) {
    if (activity.steps.length === 0) {
        toast('Add a click first.');
        return;
    }
    start_run(activity, { step: from || 0 });
}

// ---------- small pieces ----------

/*
 * mini_screen(step, tiny) -> a small picture of the window with the step's pixel on it
 */
function mini_screen(step, tiny) {
    const view = view_now();
    const p = step_point(step, view);
    const left = clamp(p.x / Math.max(1, view.w), 0, 1) * 100;
    const top = clamp(p.y / Math.max(1, view.h), 0, 1) * 100;
    return h('div', { class: tiny ? 'screen tiny' : 'screen', title: `(${Math.round(p.x)}, ${Math.round(p.y)}) in a ${view.w}×${view.h} window` },
        h('div', { class: 'dot', style: { left: `${left}%`, top: `${top}%` } }));
}

/*
 * step_summary(step) -> one line for a closed step: action, then what it waits for
 */
function step_summary(step) {
    const parts = [describe_action(step)];
    if (step.after.length > 0) {
        parts.push(`then waits: ${step.after.length === 1 ? CHECKS[step.after[0].kind].label.toLowerCase() : `${step.after.length} checks`}`);
    }
    if (step.pause_ms > 0) {
        parts.push(`pause ${format_ms(step.pause_ms)}`);
    }
    return parts.join(' · ');
}

/*
 * render_checks(index, which) -> the "before" or "after" checks of a step, editable
 */
function render_checks(index, which) {
    const step = panel.activity.steps[index];
    const rows = [];
    const checks = step[which];
    for (let c = 0; c < checks.length; c++) {
        const check = checks[c];
        const k = c;
        const value = CHECKS[check.kind].value
            ? (check.kind === 'wait'
                ? seconds_field(to_number(check.value, 0), function (ms) {
                    edit_step(index, function (s) { s[which][k].value = String(ms); }, false);
                })
                : text_field(check.value, function (v) {
                    edit_step(index, function (s) { s[which][k].value = v; }, false);
                }, { placeholder: '*/checkout* or /regex/', class: 'grow' }))
            : null;
        const limits = check.kind === 'wait' ? null : h('span', { class: 'row muted' }, 'max',
            seconds_field(check.timeout_ms, function (ms) {
                edit_step(index, function (s) { s[which][k].timeout_ms = ms; }, false);
            }), 's, then',
            select_field(check.on_timeout, { stop: 'stop', 'continue': 'go on' }, function (v) {
                edit_step(index, function (s) { s[which][k].on_timeout = v; }, false);
            }));
        rows.push(h('div', { class: 'check' },
            h('span', { class: 'kind' }, CHECKS[check.kind].label, check.kind === 'wait' ? null : h('span', { class: 'muted' }, check_now(check, location.href) ? ' · true now' : '')),
            value, limits,
            h('button', {
                class: 'btn ghost small', title: 'Remove this check',
                on_click: function () {
                    edit_step(index, function (s) { s[which].splice(k, 1); }, true);
                },
            }, '✕')));
    }
    const kinds = { '': which === 'before' ? '＋ Wait before…' : '＋ Wait after…' };
    for (const kind of Object.keys(CHECKS)) {
        kinds[kind] = CHECKS[kind].label;
    }
    rows.push(select_field('', kinds, function (kind) {
        if (kind !== '') {
            edit_step(index, function (s) { s[which].push(check_create(kind)); }, true);
        }
    }));
    return rows;
}

/*
 * render_action_fields(index) -> the fields of the step's action (text, key, scroll, hold)
 */
function render_action_fields(index) {
    const step = panel.activity.steps[index];
    const set = function (field, rerender) {
        return function (value) {
            edit_step(index, function (s) { s[field] = value; }, rerender);
        };
    };
    const out = [];
    if (step.action === 'type') {
        out.push(h('div', { class: 'row' }, text_field(step.text, set('text', true), { placeholder: 'Text to type', class: 'grow' })),
            h('label', { class: 'row' }, h('input', {
                type: 'checkbox', checked: step.clear_first,
                on_change: function (event) { set('clear_first', false)(event.target.checked); },
            }), 'Empty the field first'));
    } else if (step.action === 'key') {
        out.push(h('div', { class: 'row' }, 'Key', text_field(step.key, set('key', true), { placeholder: 'Enter, Escape, Tab, a…' })));
    } else if (step.action === 'scroll') {
        out.push(h('div', { class: 'row' }, 'Down', number_field(step.scroll_dy, set('scroll_dy', true)), 'px, right',
            number_field(step.scroll_dx, set('scroll_dx', true)), 'px'));
    } else if (step.action === 'long_press') {
        out.push(h('div', { class: 'row' }, 'Hold for', seconds_field(step.hold_ms, set('hold_ms', true)), 's'));
    } else if (step.action === 'read') {
        out.push(h('div', { class: 'row' }, 'Keep it as {', text_field(step.var_name, function (v) {
            set('var_name', true)(v.replace(/[^\w-]/g, '') || 'answer');
        }, { style: { width: '110px' } }), '}'),
        h('div', { class: 'row' }, text_field(step.read_pattern, set('read_pattern', true), {
            placeholder: 'Only part of it: /regex/ (first group), optional', class: 'grow',
        })));
    } else if (step.action === 'side') {
        out.push(render_side_fields(index));
    }
    if (step.action === 'type' || step.action === 'side') {
        out.push(h('div', { class: 'muted' }, 'Write {name} to put in a value a "Read text" step read earlier in the run.'));
    }
    if (step.action !== 'wait' && step.action !== 'side') {
        out.push(h('div', { class: 'row' }, 'Do it', number_field(step.repeat, function (n) {
            set('repeat', true)(clamp(Math.round(n), 1, 1000));
        }, { min: '1' }), 'time(s), every', seconds_field(step.repeat_pause_ms, set('repeat_pause_ms', false)), 's'));
    }
    return out;
}

/*
 * render_side_fields(index) -> the fields of an "other site" step
 */
function render_side_fields(index) {
    const step = panel.activity.steps[index];
    const choices = { '': '— pick an activity —' };
    for (const other of all_activities()) {
        if (other.id !== panel.activity.id) {
            choices[other.id] = `${other.name} (${new URL(other.site).hostname})`;
        }
    }
    const other = step.side_activity === '' ? null : load_activity(step.side_activity);
    return [
        h('div', { class: 'row' }, 'Play', select_field(step.side_activity, choices, function (v) {
            edit_step(index, function (s) { s.side_activity = v; }, true);
        })),
        Object.keys(choices).length === 1
            ? h('div', { class: 'muted' }, 'First make that activity: open the other site, open followMe there and record its steps, ending with a "Read text" step for each answer you need.')
            : null,
        h('div', { class: 'row' }, 'on', text_field(step.side_url, function (v) {
            edit_step(index, function (s) { s.side_url = v.trim(); }, true);
        }, { placeholder: other === null ? 'https://… (page to open)' : other.start_url, class: 'grow', title: 'Page to open; empty = where that activity was made' })),
        h('div', { class: 'row' }, 'In', select_field(step.side_how, SIDE_HOWS, function (v) {
            edit_step(index, function (s) { s.side_how = v; }, false);
        }), select_field(step.side_place, { right: 'on the right', left: 'on the left' }, function (v) {
            edit_step(index, function (s) { s.side_place = v; }, false);
        })),
        h('div', { class: 'row' }, 'Give up after', seconds_field(step.side_timeout_ms, function (ms) {
            edit_step(index, function (s) { s.side_timeout_ms = Math.max(1000, ms); }, false);
        }), 's'),
        h('label', { class: 'row' }, h('input', {
            type: 'checkbox', checked: step.side_close,
            on_change: function (event) {
                edit_step(index, function (s) { s.side_close = event.target.checked; }, false);
            },
        }), 'Close it when done and come back here'),
    ];
}

/*
 * render_step_body(index) -> the open step: where, what, how, waits and pause
 */
function render_step_body(index) {
    const step = panel.activity.steps[index];
    const action_names = {};
    for (const key of Object.keys(ACTIONS)) {
        action_names[key] = ACTIONS[key].label;
    }
    const sections = [];
    if (ACTIONS[step.action].point) {
        const now = step_point(step, view_now());
        const hit = hit_at(now.x, now.y);
        sections.push(h('div', { class: 'section' },
            h('div', { class: 'label' }, 'Where on the screen'),
            h('div', { class: 'row' }, mini_screen(step, false),
                h('div', { class: 'grow' },
                    h('div', { class: 'row' }, 'x', number_field(step.x, function (v) {
                        edit_step(index, function (s) { s.x = Math.round(v); }, true);
                    }), 'y', number_field(step.y, function (v) {
                        edit_step(index, function (s) { s.y = Math.round(v); }, true);
                    })),
                    h('button', { class: 'btn small', style: { marginTop: '6px' }, on_click: function () { remark_step(index); } }, '📍 Mark again on the page'))),
            h('div', { class: 'row', style: { marginTop: '6px' } }, 'Keeps', select_field(step.place, PLACES, function (v) {
                const view = view_now();
                edit_step(index, function (s) {
                    s.place = v;
                    s.scroll_x = view.scroll_x;
                    s.scroll_y = view.scroll_y;
                    s.view_w = view.w;
                    s.view_h = view.h;
                }, true);
            })),
            h('div', { class: 'hits', style: { marginTop: '6px' } }, 'Right now that pixel is ', h('code', null, describe_target(hit === null ? null : hit.el)),
                h('div', { class: 'muted' }, `Point: ${describe_place(step)}.`))));
    }
    sections.push(h('div', { class: 'section' },
        h('div', { class: 'label' }, 'What it does'),
        h('div', { class: 'row' }, select_field(step.action, action_names, function (v) {
            edit_step(index, function (s) { s.action = v; }, true);
        }), text_field(step.label, function (v) {
            edit_step(index, function (s) { s.label = v.trim(); }, true);
        }, { placeholder: `Name (default "${step_title(Object.assign({}, step, { label: '' }), index)}")`, class: 'grow' })),
        render_action_fields(index)));
    sections.push(h('div', { class: 'section' },
        h('div', { class: 'label' }, 'How'),
        h('div', { class: 'how' }, describe_how(step))));
    sections.push(h('div', { class: 'section' },
        h('div', { class: 'label' }, 'Before it, wait until'),
        render_checks(index, 'before')));
    sections.push(h('div', { class: 'section' },
        h('div', { class: 'label' }, 'After it, wait until'),
        render_checks(index, 'after')));
    sections.push(h('div', { class: 'section' },
        h('div', { class: 'label' }, 'Then pause'),
        h('div', { class: 'row' }, seconds_field(step.pause_ms, function (ms) {
            edit_step(index, function (s) { s.pause_ms = ms; }, true);
        }), 's, give or take', seconds_field(step.jitter_ms, function (ms) {
            edit_step(index, function (s) { s.jitter_ms = ms; }, false);
        }), 's at random')));
    sections.push(h('div', { class: 'row' },
        h('button', {
            class: 'btn small', title: 'Do only this step\'s action now, without its waits',
            on_click: function () {
                test_step(step, panel.activity).then(function (vars) {
                    const names = Object.keys(vars);
                    const got = [];
                    for (const name of names) {
                        got.push(`{${name}} = "${String(vars[name]).slice(0, 80)}"`);
                    }
                    toast(names.length === 0 ? `${step_title(step, index)} done` : `${step_title(step, index)}: ${got.join(', ')}`);
                }, function (e) {
                    toast(e.message, { type: 'error' });
                });
            },
        }, '▶ Test this step'),
        h('button', { class: 'btn small', on_click: function () { play_activity(panel.activity, index); } }, '▶ Play from here'),
        h('span', { class: 'grow' }),
        h('button', {
            class: 'btn small danger',
            on_click: function () {
                commit(function (activity) { activity.steps.splice(index, 1); }, false);
                panel.open_step = -1;
                panel_render();
            },
        }, 'Delete step')));
    return h('div', { class: 'step-body' }, sections);
}

/*
 * render_step(index) -> one step row (and its body when open)
 */
function render_step(index) {
    const step = panel.activity.steps[index];
    const open = panel.open_step === index;
    const row = h('div', { class: `step${step.enabled ? '' : ' off'}` },
        h('div', {
            class: 'step-head',
            on_click: function () {
                panel.open_step = open ? -1 : index;
                panel_render();
            },
        },
        h('span', { class: 'badge' }, String(index + 1)),
        ACTIONS[step.action].point ? mini_screen(step, true) : null,
        h('div', { class: 'what' },
            h('div', { class: 'title' }, step_title(step, index)),
            h('div', { class: 'desc' }, step_summary(step))),
        h('input', {
            type: 'checkbox', checked: step.enabled, title: 'Play this step',
            on_click: function (event) { event.stopPropagation(); },
            on_change: function (event) {
                edit_step(index, function (s) { s.enabled = event.target.checked; }, true);
            },
        }),
        h('button', { class: 'btn ghost small', title: 'Move up', on_click: function (event) { event.stopPropagation(); move_step(index, -1); } }, '▲'),
        h('button', { class: 'btn ghost small', title: 'Move down', on_click: function (event) { event.stopPropagation(); move_step(index, 1); } }, '▼')),
        open ? render_step_body(index) : null);
    return row;
}

// ---------- views ----------

/*
 * render_list() -> the list of this site's activities
 */
function render_list() {
    const list = activities_for(location.href);
    const cards = [];
    for (const activity of list) {
        const a = activity;
        cards.push(h('div', { class: 'card clickable', on_click: function () { open_activity(a); } },
            h('div', { class: 'row' },
                h('h3', { class: 'grow' }, a.name),
                h('button', {
                    class: 'btn primary small', title: 'Play',
                    on_click: function (event) {
                        event.stopPropagation();
                        play_activity(a, 0);
                    },
                }, '▶')),
            h('div', { class: 'muted' }, `${a.steps.length} step${a.steps.length === 1 ? '' : 's'} · about ${format_ms(activity_duration(a))} · `
                + (a.loops === 0 ? 'loops until stopped' : `${a.loops}×`))));
    }
    if (cards.length === 0) {
        cards.push(h('div', { class: 'empty' },
            h('div', null, h('b', null, 'No activities on this site yet.')),
            h('div', null, 'An activity is a list of clicks on pixels you mark, with pauses and checks between them.')));
    }
    return [h('button', { class: 'btn primary', on_click: new_activity }, '＋ New activity'), cards];
}

/*
 * render_detail() -> one activity: settings, then its steps
 */
function render_detail() {
    const a = panel.activity;
    panel.rows = [];
    const steps = [];
    for (let i = 0; i < a.steps.length; i++) {
        const row = render_step(i);
        panel.rows.push(row);
        steps.push(row);
        if (i < a.steps.length - 1) {
            steps.push(h('div', { class: 'flow' }, `↓ ${format_ms(a.steps[i].pause_ms)}`));
        }
    }
    if (steps.length === 0) {
        steps.push(h('div', { class: 'empty' }, 'No steps yet. ', h('b', null, 'Add a click'), ' and then click the spot on the page.'));
    }
    return [
        h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', on_click: close_activity }, '←'),
            text_field(a.name, function (v) {
                commit(function (act) { act.name = v.trim() || 'Untitled'; }, false);
            }, { class: 'name grow', 'aria-label': 'Activity name' })),
        h('div', { class: 'row' },
            h('button', { class: 'btn primary', on_click: function () { play_activity(a, 0); } }, '▶ Play'),
            h('button', { class: 'btn', on_click: stop_run }, '■ Stop'),
            h('span', { class: 'grow' }),
            'Loops', number_field(a.loops, function (n) {
                commit(function (act) { act.loops = clamp(Math.round(n), 0, 100000); }, true);
            }, { min: '0', title: '0 = until stopped' }),
            'every', seconds_field(a.loop_pause_ms, function (ms) {
                commit(function (act) { act.loop_pause_ms = ms; }, false);
            }), 's'),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Runs on'), text_field(a.pages, function (v) {
            commit(function (act) { act.pages = v.trim() || `${act.site}/*`; }, false);
        }, { class: 'grow', title: 'Pages this activity is for: a * pattern or /regex/' })),
        render_device_row(a),
        h('div', { class: 'row' },
            h('label', { class: 'row' }, h('input', {
                type: 'checkbox', checked: a.need_online,
                on_change: function (event) {
                    commit(function (act) { act.need_online = event.target.checked; }, true);
                },
            }), 'Only play with internet'),
            a.need_online ? select_field(a.offline, { wait: 'if it\'s off, wait for it', stop: 'if it\'s off, stop' }, function (v) {
                commit(function (act) { act.offline = v; }, false);
            }) : null),
        h('div', { class: 'steps' }, steps),
        h('div', { class: 'row' },
            h('button', { class: 'btn primary', on_click: function () { add_point_step('click'); } }, '＋ Add click (mark on page)'),
            select_field('', {
                '': '＋ Other step…', read: 'Read text (mark on page)', side: 'Run on another site (split view)', wait: 'Only wait', key: 'Press a key',
            }, function (v) {
                if (v === 'read') {
                    add_point_step('read');
                } else if (v !== '') {
                    add_other_step(v);
                }
            })),
    ];
}

/*
 * render_device_row(a) -> "View as [Mobile] [Portrait]", and a button when this tab is
 *   shown differently
 */
function render_device_row(a) {
    const same = device_matches(device_current, a.device, a.orientation);
    return h('div', { class: 'row' },
        h('span', { class: 'muted' }, 'View as'),
        select_field(a.device, DEVICES, function (v) {
            commit(function (act) { act.device = v; }, true);
        }),
        a.device === 'desktop' ? null : select_field(a.orientation, ORIENTATIONS, function (v) {
            commit(function (act) { act.orientation = v; }, true);
        }),
        same ? null : h('button', {
            class: 'btn small', title: 'Show this tab that way now, to mark points on that layout (the page reloads)',
            on_click: function () { switch_device(a.device, a.orientation); },
        }, 'Show it now'),
        !same || device_current.mode === 'desktop' ? null : h('span', { class: 'muted' }, '· this tab now'),
        device_supported() ? null : h('span', { class: 'muted' }, '(needs Moss 0.2+)'));
}

/*
 * render_net() — the online light in the header
 */
function render_net() {
    if (panel.net === null) {
        return;
    }
    let state = 'checking';
    if (net.online === true) {
        state = 'on';
    } else if (net.online === false) {
        state = 'off';
    }
    const words = { on: 'Online', off: 'Offline', checking: 'Checking…' };
    panel.net.className = `net ${state}`;
    panel.net.textContent = words[state];
    panel.net.title = state === 'off' ? 'No internet connection: activities that need it wait. Click to check again.' : 'Internet connection — click to check again';
}

/*
 * render_transfer() -> export / import as JSON
 */
function render_transfer() {
    const area = h('textarea', { spellcheck: 'false' }, export_activities(activities_for(location.href)));
    return [
        h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', on_click: function () { panel.view = 'list'; panel_render(); } }, '←'),
            h('b', null, 'Export / import')),
        h('div', { class: 'muted' }, 'This site\'s activities as JSON. Copy it to keep or share; paste JSON here and click Import to add activities.'),
        area,
        h('div', { class: 'row' },
            h('button', {
                class: 'btn',
                on_click: function () {
                    navigator.clipboard.writeText(area.value).then(function () { toast('Copied'); });
                },
            }, 'Copy'),
            h('button', {
                class: 'btn primary',
                on_click: function () {
                    try {
                        toast(`Imported ${import_activities(area.value)} activities`);
                        panel.view = 'list';
                        panel_render();
                    } catch (e) {
                        toast(`Import failed: ${e.message}`, { type: 'error' });
                    }
                },
            }, 'Import')),
    ];
}

/*
 * panel_render() — draw the panel for the current view
 */
function panel_render() {
    if (!panel.prefs.open) {
        return;
    }
    if (panel.layer === null) {
        panel.layer = layer_create('panel', PANEL_CSS);
    }
    if (panel.view === 'detail' && panel.activity !== null) {
        panel.activity = load_activity(panel.activity.id);
        if (panel.activity === null) {
            panel.view = 'list';
        }
    }
    let body = null;
    if (panel.view === 'detail') {
        body = render_detail();
    } else if (panel.view === 'transfer') {
        body = render_transfer();
    } else {
        body = render_list();
    }
    panel.net = h('button', {
        class: 'net',
        on_click: function () {
            panel.net.className = 'net checking';
            panel.net.textContent = 'Checking…';
            check_online(true).then(render_net);
        },
    });
    panel.status = h('div', { class: 'status', hidden: true }, h('span', { class: 'text' }), h('button', { class: 'btn small', on_click: stop_run }, '■ Stop'));
    const side = panel.prefs.side;
    const root = h('div', { class: `fm panel ${side}` },
        h('div', { class: 'head' },
            h('span', { class: 'logo' }, 'follow', h('b', null, 'Me')),
            h('span', { class: 'site grow' }, location.hostname),
            panel.net,
            h('button', {
                class: 'btn ghost small', title: 'Move to the other side',
                on_click: function () {
                    panel.prefs.side = side === 'right' ? 'left' : 'right';
                    save_prefs(panel.prefs);
                    panel_render();
                    tab_render();
                },
            }, '⇆'),
            h('button', { class: 'btn ghost small', title: 'Close (Alt+Shift+P)', on_click: panel_close }, '✕')),
        h('div', { class: 'body' }, body),
        panel.status,
        h('div', { class: 'foot' },
            h('label', { class: 'row' }, h('input', {
                type: 'checkbox', checked: panel.prefs.show_marks,
                on_change: function (event) {
                    panel.prefs.show_marks = event.target.checked;
                    save_prefs(panel.prefs);
                    show_marks();
                },
            }), 'Show marks'),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn small', on_click: function () { panel.view = 'transfer'; panel_render(); } }, 'Export / import')));
    panel.layer.root.replaceChildren(h('style', null, BASE_CSS + PANEL_CSS), root);
    render_net();
    show_marks();
    if (current_run !== null) {
        render_status(current_run);
    }
}

/*
 * render_status(run) — the status bar and the playing step, without redrawing the panel
 */
function render_status(run) {
    const playing = ['before', 'action', 'after', 'pause'].indexOf(run.phase) >= 0 && !run.stopped;
    if (panel.status !== null) {
        panel.status.hidden = false;
        panel.status.className = `status ${run.phase}`;
        const left = run.left_ms > 0 ? ` · ${format_ms(run.left_ms)}` : '';
        const loop = run.activity.loops === 1 ? '' : ` [loop ${run.loop + 1}${run.activity.loops === 0 ? '' : `/${run.activity.loops}`}]`;
        panel.status.firstChild.textContent = `${playing ? '▶ ' : ''}${run.text}${left}${loop}`;
        panel.status.lastChild.hidden = !playing;
    }
    const same = panel.view === 'detail' && panel.activity !== null && panel.activity.id === run.activity.id;
    for (let i = 0; i < panel.rows.length; i++) {
        panel.rows[i].classList.toggle('current', same && playing && i === run.step);
    }
    if (playing) {
        if (!same || !panel.prefs.open) {
            marks_set(run.activity, -1, null);
        }
        marks_active(run.step);
    } else {
        marks_active(-1);
        show_marks();
    }
    tab_render();
}

// ---------- the edge tab ----------

let tab_layer = null;

/*
 * tab_render() — the small tab on the window's edge that opens the panel
 */
function tab_render() {
    if (panel.prefs.open) {
        if (tab_layer !== null) {
            layer_remove(tab_layer);
            tab_layer = null;
        }
        return;
    }
    if (tab_layer === null) {
        tab_layer = layer_create('tab', TAB_CSS);
    }
    const side = panel.prefs.side;
    tab_layer.root.replaceChildren(h('style', null, BASE_CSS + TAB_CSS), h('div', { class: 'fm' },
        h('button', {
            class: `tab ${side}${is_running() ? ' running' : ''}`,
            title: is_running() ? 'followMe is playing — click to open (Esc stops)' : 'followMe (Alt+Shift+P)',
            style: { top: `calc(${clamp(panel.prefs.tab_y, 0, 1) * 100}% - 32px)` },
            on_click: panel_toggle,
        }, 'followMe')));
}
