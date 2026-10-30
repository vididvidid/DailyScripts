'use strict';
/*
 * The data followMe stores: activities made of steps, and the checks attached to them.
 *
 * struct activity {
 *     id, name: string;
 *     site: string;            origin it was made on, "https://example.com"
 *     pages: string;           where it may run: a "*" glob or /regex/ over the URL
 *     start_url: string;       page it was made on; another activity's "other site" step opens it
 *     loops: number;           how many times to play it; 0 = until stopped
 *     loop_pause_ms: number;   pause between two loops
 *     device: 'desktop' | 'mobile' | 'tablet';   how the tab is shown while it plays
 *     orientation: 'portrait' | 'landscape';     for mobile and tablet
 *     need_online: boolean;    only play while the internet is on
 *     offline: 'wait' | 'stop';   what to do when it is off
 *     unsaved: string[];       ids of steps changed since the last Save ('' = the activity's
 *                              own settings); kept here only, not in the gist
 *     steps: struct step[];
 *     created_at, updated_at: number;
 * }
 *
 * struct step {
 *     id: string;
 *     label: string;           optional name ("Open menu"); empty = "Click 3"
 *     action: 'click' | 'double_click' | 'right_click' | 'long_press' | 'type' | 'key' | 'scroll' | 'read' | 'side' | 'wait';
 *     x, y: number;            where it was marked, in CSS pixels of the visible page
 *     place: 'element' | 'screen' | 'page' | 'scaled';   how x, y follow layout changes,
 *                              scrolling and resizing ('element': see anchor.js)
 *     anchor: struct anchor | null;   'element': the element under the point
 *     scroll_x, scroll_y: number;   page scroll when it was marked ('page')
 *     view_w, view_h: number;       window size when it was marked ('scaled')
 *     text: string;            'type': what to type; {name} puts in a value read earlier
 *     clear_first: boolean;    'type': empty the field first
 *     type_into: 'point' | 'focused';   'type': click the field at x, y first, or type into
 *                              the field that has the focus (a click step before put it there)
 *     type_mode: 'keys' | 'paste';   'type': one key at a time, or all at once
 *     key_delay_ms: number;    'type' key by key: pause between two keys
 *     enter_after: boolean;    'type': press Enter when done (submits a search box)
 *     key: string;             'key': "Enter", "Escape", "Tab", "a", …
 *     scroll_dx, scroll_dy: number;   'scroll': how far
 *     hold_ms: number;         'long_press': how long the button stays down
 *     var_name: string;        'read': the value's name, used later as {name}
 *     read_pattern: string;    'read': optional /regex/ (its first group) to keep part of the text
 *     side_activity: string;   'side': id of the activity to play on the other site
 *     side_url: string;        'side': page to open; '' = where that activity was made
 *     side_how: 'auto' | 'split' | 'window';   'side': Chrome split view or a second window
 *     side_place: 'right' | 'left';
 *     side_timeout_ms: number; 'side': give up after this long
 *     side_close: boolean;     'side': close it when it is done
 *     repeat: number;          do the action this many times
 *     repeat_pause_ms: number; pause between repeats
 *     before: struct check[];  waited for before the action
 *     after: struct check[];   waited for after the action
 *     pause_ms: number;        the break after the step, before the next one
 *     jitter_ms: number;       random ± on every pause, so timing isn't robotic
 *     enabled: boolean;        skipped when false
 * }
 *
 * struct check {
 *     kind: 'loaded' | 'url_changed' | 'url_matches' | 'online' | 'wait';
 *     value: string;           'url_matches': glob or /regex/; 'wait': ms
 *     timeout_ms: number;      give up after this long
 *     on_timeout: 'stop' | 'continue';
 * }
 *
 * Values: a 'read' step keeps what it read under its var_name for the rest of the run;
 * an 'other site' step hands the run's values to the activity it plays there and gets
 * back everything that activity read. {name} in a 'type' text or a URL is replaced by
 * the value.
 */

const ACTIONS = {
    click: { label: 'Left click', point: true },
    double_click: { label: 'Double click', point: true },
    right_click: { label: 'Right click', point: true },
    long_press: { label: 'Long press', point: true },
    type: { label: 'Type text', point: true },
    key: { label: 'Press a key', point: false },
    scroll: { label: 'Scroll', point: true },
    read: { label: 'Read text', point: true },
    side: { label: 'Run on another site', point: false },
    wait: { label: 'Only wait', point: false },
};

const CHECKS = {
    loaded: { label: 'Page fully loaded', value: false },
    url_changed: { label: 'URL changed', value: false },
    url_matches: { label: 'URL matches…', value: true },
    online: { label: 'Internet is on', value: false },
    wait: { label: 'Wait a fixed time', value: true },
};

const PLACES = {
    element: 'Follows the element there (moves with the layout)',
    screen: 'Same spot on the screen',
    page: 'Same spot on the page (follows scrolling)',
    scaled: 'Same spot relative to the window size',
};

const TYPE_INTO = { focused: 'the field that has the focus (click it in the step before)', point: 'the field at a point (clicks it first)' };
const TYPE_MODES = { keys: 'key by key', paste: 'all at once' };

const SIDE_HOWS = { auto: 'split view (or a window)', split: 'split view only', window: 'a window beside this one' };

const DEFAULT_TIMEOUT = 30000;

// Fields added after 0.1.0, filled in on activities and steps stored before.
const ACTIVITY_DEFAULTS = { start_url: '', device: 'desktop', orientation: 'portrait', need_online: true, offline: 'wait', unsaved: [] };
const STEP_DEFAULTS = {
    type_into: 'point', type_mode: 'paste', key_delay_ms: 60, enter_after: false, anchor: null,
    var_name: 'answer', read_pattern: '', side_activity: '', side_url: '', side_how: 'auto', side_place: 'right',
    side_timeout_ms: 120000, side_close: true,
};

/*
 * activity_create(name, url) -> a new, empty struct activity for the page at url
 */
function activity_create(name, url) {
    const site = site_of(url);
    return {
        id: new_id('act'),
        name: name,
        site: site,
        pages: `${site}/*`,
        start_url: url,
        loops: 1,
        loop_pause_ms: 1000,
        device: 'desktop',
        orientation: 'portrait',
        need_online: true,
        offline: 'wait',
        steps: [],
        created_at: Date.now(),
        updated_at: Date.now(),
    };
}

/*
 * step_create(x, y, view) -> a left click at (x, y); view: { scroll_x, scroll_y, w, h }
 */
function step_create(x, y, view) {
    return {
        id: new_id('step'),
        label: '',
        action: 'click',
        x: Math.round(x),
        y: Math.round(y),
        place: 'element',
        anchor: null,
        scroll_x: Math.round(view.scroll_x),
        scroll_y: Math.round(view.scroll_y),
        view_w: Math.round(view.w),
        view_h: Math.round(view.h),
        text: '',
        clear_first: true,
        type_into: 'point',
        type_mode: 'keys',
        key_delay_ms: 60,
        enter_after: false,
        key: 'Enter',
        scroll_dx: 0,
        scroll_dy: 400,
        hold_ms: 800,
        var_name: 'answer',
        read_pattern: '',
        side_activity: '',
        side_url: '',
        side_how: 'auto',
        side_place: 'right',
        side_timeout_ms: 120000,
        side_close: true,
        repeat: 1,
        repeat_pause_ms: 300,
        before: [],
        after: [],
        pause_ms: 1000,
        jitter_ms: 0,
        enabled: true,
    };
}

/*
 * step_has_point(step) -> true if the step acts at its x, y (and gets a mark on the page)
 */
function step_has_point(step) {
    if (step.action === 'type') {
        return step.type_into !== 'focused';
    }
    return ACTIONS[step.action].point;
}

/*
 * activity_fix(activity) -> the same activity with fields newer versions added filled in
 */
function activity_fix(activity) {
    const a = Object.assign({}, ACTIVITY_DEFAULTS, activity);
    if (a.start_url === '') {
        a.start_url = `${a.site}/`;
    }
    const steps = [];
    for (const step of a.steps || []) {
        steps.push(Object.assign({}, STEP_DEFAULTS, step));
    }
    a.steps = steps;
    return a;
}

/*
 * fill_vars(text, vars) -> text with every {name} of a known value replaced by it
 */
function fill_vars(text, vars) {
    return String(text).replace(/\{([A-Za-z_][\w-]*)\}/g, function (all, name) {
        return vars !== null && vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : all;
    });
}

/*
 * check_create(kind) -> a struct check with sensible defaults
 */
function check_create(kind) {
    let value = '';
    if (kind === 'wait') {
        value = '1000';
    } else if (kind === 'url_matches') {
        value = '*/done*';
    }
    return { kind: kind, value: value, timeout_ms: DEFAULT_TIMEOUT, on_timeout: 'stop' };
}

/*
 * step_title(step, index) -> "Click 3" or the step's own label
 */
function step_title(step, index) {
    if (step.label) {
        return step.label;
    }
    const words = { wait: 'Wait', type: 'Type', key: 'Key', scroll: 'Scroll', read: 'Read', side: 'Other site' };
    const word = words[step.action] === undefined ? 'Click' : words[step.action];
    return `${word} ${index + 1}`;
}

/*
 * step_point(step, view) -> { x, y } where the step acts now, in viewport pixels;
 *   view: { scroll_x, scroll_y, w, h } of the page as it is now
 */
function step_point(step, view) {
    if (step.place === 'page') {
        return { x: step.x + step.scroll_x - view.scroll_x, y: step.y + step.scroll_y - view.scroll_y };
    }
    if (step.place === 'scaled' && step.view_w > 0 && step.view_h > 0) {
        return { x: Math.round(step.x * view.w / step.view_w), y: Math.round(step.y * view.h / step.view_h) };
    }
    return { x: step.x, y: step.y };
}

/*
 * describe_check(check) -> "the page is fully loaded (up to 30 s)"
 */
function describe_check(check) {
    const limit = `up to ${format_ms(check.timeout_ms)}, then ${check.on_timeout === 'stop' ? 'stop' : 'go on'}`;
    switch (check.kind) {
    case 'loaded':
        return `the page has fully loaded (${limit})`;
    case 'url_changed':
        return `the URL has changed (${limit})`;
    case 'url_matches':
        return `the URL matches ${check.value} (${limit})`;
    case 'online':
        return `the internet is on (${limit})`;
    case 'wait':
        return `${format_ms(to_number(check.value, 0))} have passed`;
    default:
        return check.kind;
    }
}

/*
 * describe_action(step) -> "left click at (412, 230)"
 */
function describe_action(step) {
    const at = `at (${step.x}, ${step.y})`;
    switch (step.action) {
    case 'click':
        return `left click ${at}`;
    case 'double_click':
        return `double click ${at}`;
    case 'right_click':
        return `right click ${at}`;
    case 'long_press':
        return `press and hold ${format_ms(step.hold_ms)} ${at}`;
    case 'type':
        return `type "${step.text}"${step.type_into === 'focused' ? ' into the focused field' : ` into the field ${at}`}${step.enter_after ? ', then Enter' : ''}`;
    case 'key':
        return `press ${step.key}`;
    case 'read':
        return `read the text ${at} as {${step.var_name}}`;
    case 'side':
        return `open ${side_target(step)} beside this page and play "${side_name(step)}" there`;
    case 'scroll':
        return `scroll ${step.scroll_dy >= 0 ? 'down' : 'up'} ${Math.abs(step.scroll_dy)} px${step.scroll_dx !== 0 ? `, ${step.scroll_dx >= 0 ? 'right' : 'left'} ${Math.abs(step.scroll_dx)} px` : ''} ${at}`;
    default:
        return 'do nothing, only wait';
    }
}

/*
 * describe_how(step) -> how the step is carried out, in plain words
 */
function describe_how(step) {
    switch (step.action) {
    case 'click':
    case 'double_click':
    case 'right_click':
        return 'Finds whatever is drawn at that pixel and sends it the same pointer and mouse events a real click makes (move, down, up, click), with the button and count of this action.';
    case 'long_press':
        return 'Presses the left button on whatever is at that pixel, keeps it down for the hold time, then releases it.';
    case 'type':
        return `${step.type_into === 'focused' ? 'Takes the field that has the focus (the one the step before clicked)' : 'Clicks the field at that pixel to focus it'}${step.clear_first ? ', empties it' : ''}, then types the text ${step.type_mode === 'keys' ? 'one key at a time (key down, input, key up for each character), so search boxes show their suggestions' : 'all at once'} and tells the page the value changed.${step.enter_after ? ' Then it presses Enter; if the page doesn\'t handle that itself, the field\'s form is submitted.' : ''}`;
    case 'key':
        return 'Sends key down, key press and key up to whatever has the focus. Enter in a form field also submits the form.';
    case 'scroll':
        return 'Scrolls the nearest scrollable box under that pixel (or the page).';
    case 'read':
        return `Takes the text of whatever is at that pixel (a field's value, or the words shown)${step.read_pattern ? `, keeps the part matching ${step.read_pattern}` : ''}, and remembers it as {${step.var_name}}: later steps can type it, and an "other site" step hands it back to the activity that opened this one.`;
    case 'side':
        return 'Opens the page next to this one (Chrome\'s split view, or a second window beside this one), plays the chosen activity there with the values read so far, waits until it finishes, brings back every value it read, then closes it and carries on here.';
    default:
        return 'Does nothing itself: only its checks and the pause run.';
    }
}

/*
 * side_name(step) -> name of the activity an 'other site' step plays, or a hint
 */
function side_name(step) {
    const other = step.side_activity === '' ? null : load_activity(step.side_activity);
    return other === null ? '(pick an activity)' : other.name;
}

/*
 * side_target(step) -> the host an 'other site' step opens
 */
function side_target(step) {
    const other = step.side_activity === '' ? null : load_activity(step.side_activity);
    const url = step.side_url !== '' ? step.side_url : (other === null ? '' : other.start_url);
    try {
        return new URL(url.replace(/\{[^}]*\}/g, 'x')).hostname;
    } catch (e) {
        return 'another site';
    }
}

/*
 * describe_place(step) -> how the point follows scrolling or resizing
 */
function describe_place(step) {
    if (step.place === 'element') {
        return 'it follows the element marked there, wherever the layout moves it (pinning, resizing, banners); without one, the pixel';
    }
    if (step.place === 'page') {
        return `on the page: marked with the page scrolled to (${step.scroll_x}, ${step.scroll_y}); it scrolls there if needed`;
    }
    if (step.place === 'scaled') {
        return `relative to the window: marked in a ${step.view_w}×${step.view_h} window and scaled to the current size`;
    }
    return 'a fixed spot on the screen, wherever the page is scrolled';
}

/*
 * activity_runs_on(activity, url) -> true if the activity is meant for that page
 */
function activity_runs_on(activity, url) {
    return glob_test(activity.pages || `${activity.site}/*`, url);
}

/*
 * activity_duration(activity) -> rough length of one loop in ms (pauses and waits only)
 */
function activity_duration(activity) {
    let total = 0;
    for (const step of activity.steps) {
        if (!step.enabled) {
            continue;
        }
        total += step.pause_ms + (step.repeat - 1) * step.repeat_pause_ms;
        if (step.action === 'long_press') {
            total += step.hold_ms * step.repeat;
        }
        for (const check of step.before.concat(step.after)) {
            if (check.kind === 'wait') {
                total += to_number(check.value, 0);
            }
        }
    }
    return total;
}
