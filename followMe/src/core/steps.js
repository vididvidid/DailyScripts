'use strict';
/*
 * The data followMe stores: activities made of steps, and the checks attached to them.
 *
 * struct activity {
 *     id, name: string;
 *     site: string;            origin it was made on, "https://example.com"
 *     pages: string;           where it may run: a "*" glob or /regex/ over the URL
 *     loops: number;           how many times to play it; 0 = until stopped
 *     loop_pause_ms: number;   pause between two loops
 *     steps: struct step[];
 *     created_at, updated_at: number;
 * }
 *
 * struct step {
 *     id: string;
 *     label: string;           optional name ("Open menu"); empty = "Click 3"
 *     action: 'click' | 'double_click' | 'right_click' | 'long_press' | 'type' | 'key' | 'scroll' | 'wait';
 *     x, y: number;            where it was marked, in CSS pixels of the visible page
 *     place: 'screen' | 'page' | 'scaled';   how x, y follow scrolling and resizing
 *     scroll_x, scroll_y: number;   page scroll when it was marked ('page')
 *     view_w, view_h: number;       window size when it was marked ('scaled')
 *     text: string;            'type': what to type
 *     clear_first: boolean;    'type': empty the field first
 *     key: string;             'key': "Enter", "Escape", "Tab", "a", …
 *     scroll_dx, scroll_dy: number;   'scroll': how far
 *     hold_ms: number;         'long_press': how long the button stays down
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
 *     kind: 'loaded' | 'url_changed' | 'url_matches' | 'wait';
 *     value: string;           'url_matches': glob or /regex/; 'wait': ms
 *     timeout_ms: number;      give up after this long
 *     on_timeout: 'stop' | 'continue';
 * }
 */

const ACTIONS = {
    click: { label: 'Left click', point: true },
    double_click: { label: 'Double click', point: true },
    right_click: { label: 'Right click', point: true },
    long_press: { label: 'Long press', point: true },
    type: { label: 'Type text', point: true },
    key: { label: 'Press a key', point: false },
    scroll: { label: 'Scroll', point: true },
    wait: { label: 'Only wait', point: false },
};

const CHECKS = {
    loaded: { label: 'Page fully loaded', value: false },
    url_changed: { label: 'URL changed', value: false },
    url_matches: { label: 'URL matches…', value: true },
    wait: { label: 'Wait a fixed time', value: true },
};

const PLACES = {
    screen: 'Same spot on the screen',
    page: 'Same spot on the page (follows scrolling)',
    scaled: 'Same spot relative to the window size',
};

const DEFAULT_TIMEOUT = 30000;

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
        loops: 1,
        loop_pause_ms: 1000,
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
        place: 'screen',
        scroll_x: Math.round(view.scroll_x),
        scroll_y: Math.round(view.scroll_y),
        view_w: Math.round(view.w),
        view_h: Math.round(view.h),
        text: '',
        clear_first: true,
        key: 'Enter',
        scroll_dx: 0,
        scroll_dy: 400,
        hold_ms: 800,
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
    const word = step.action === 'wait' ? 'Wait' : (step.action === 'type' ? 'Type' : (step.action === 'key' ? 'Key' : (step.action === 'scroll' ? 'Scroll' : 'Click')));
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
        return `type "${step.text}" into the field ${at}`;
    case 'key':
        return `press ${step.key}`;
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
        return `Clicks the field at that pixel to focus it${step.clear_first ? ', empties it' : ''}, then types the text and tells the page the value changed (input and change events).`;
    case 'key':
        return 'Sends key down, key press and key up to whatever has the focus. Enter in a form field also submits the form.';
    case 'scroll':
        return 'Scrolls the nearest scrollable box under that pixel (or the page).';
    default:
        return 'Does nothing itself: only its checks and the pause run.';
    }
}

/*
 * describe_place(step) -> how the point follows scrolling or resizing
 */
function describe_place(step) {
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
