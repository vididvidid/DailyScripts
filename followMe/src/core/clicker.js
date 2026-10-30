'use strict';
/*
 * Acting on a pixel. No selectors: whatever the browser draws at (x, y) is the target,
 * found with elementFromPoint (through same-origin iframes too), and it gets the same
 * sequence of pointer, mouse, focus and click events a real click produces.
 *
 * While the tab is shown as a phone or tablet (device.js) a click is a tap instead:
 * pointer events of type "touch", touchstart / touchend, then the mouse events and
 * click a phone's browser makes after a tap.
 *
 * Limits of a userscript: these events are marked untrusted (event.isTrusted is
 * false), so a page that checks that, or a cross-origin iframe (a payment box, a
 * captcha), cannot be clicked this way.
 *
 * struct hit { el: Element; x, y: number; win: Window }   x, y inside el's own frame
 */

const own_layers = [];   // followMe's own overlays, skipped when looking for a target

/*
 * register_layer(el) — mark one of followMe's elements as "not part of the page"
 */
function register_layer(el) {
    own_layers.push(el);
}

/*
 * unregister_layer(el) — forget a removed layer
 */
function unregister_layer(el) {
    const i = own_layers.indexOf(el);
    if (i >= 0) {
        own_layers.splice(i, 1);
    }
}

/*
 * view_now() -> { scroll_x, scroll_y, w, h } of the window as it is now
 */
function view_now() {
    return { scroll_x: window.scrollX, scroll_y: window.scrollY, w: window.innerWidth, h: window.innerHeight };
}

/*
 * hit_at(x, y) -> struct hit for the element drawn at viewport pixel (x, y), or null
 */
function hit_at(x, y) {
    // Hide followMe's layers for the lookup (marks sit right on the target pixels).
    // visibility, not display: hit testing skips hidden boxes, but they keep their
    // layout and scroll position, and it is put back before the next paint.
    const saved = [];
    for (const layer of own_layers) {
        saved.push(layer.style.visibility);
        layer.style.visibility = 'hidden';
    }
    let doc = document;
    let win = window;
    let lx = x;
    let ly = y;
    let el = null;
    try {
        el = doc.elementFromPoint(lx, ly);
        // Step into same-origin iframes; a cross-origin one stays the target itself.
        while (el !== null && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
            let inner = null;
            try {
                inner = el.contentDocument;
            } catch (e) {
                inner = null;
            }
            if (inner === null) {
                break;
            }
            const box = el.getBoundingClientRect();
            lx -= box.left + el.clientLeft;
            ly -= box.top + el.clientTop;
            win = el.contentWindow;
            doc = inner;
            el = doc.elementFromPoint(lx, ly);
        }
    } finally {
        for (let i = 0; i < own_layers.length; i++) {
            own_layers[i].style.visibility = saved[i];
        }
    }
    return el === null ? null : { el: el, x: lx, y: ly, win: win };
}

/*
 * describe_target(el) -> 'button "Sign in"', 'input[email]', 'a "Next →"' …
 */
function describe_target(el) {
    if (el === null || el === undefined) {
        return 'nothing (outside the page)';
    }
    let name = el.tagName.toLowerCase();
    if (el.type && (name === 'input' || name === 'button')) {
        name += `[${el.type}]`;
    }
    const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.title || el.alt || '')
        .replace(/\s+/g, ' ').trim();
    if (el.tagName === 'IFRAME') {
        return `${name} (another site's frame: clicks can't reach inside)`;
    }
    return text === '' ? name : `${name} "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;
}

/*
 * mouse_init(hit, button, buttons, detail) -> the init dictionary shared by every event
 */
function mouse_init(hit, button, buttons, detail) {
    return {
        bubbles: true, cancelable: true, composed: true, view: hit.win,
        clientX: hit.x, clientY: hit.y, screenX: hit.x + window.screenX, screenY: hit.y + window.screenY,
        button: button, buttons: buttons, detail: detail,
        pointerId: 1, pointerType: is_touch() ? 'touch' : 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0,
    };
}

/*
 * fire(hit, type, init) — dispatch one pointer or mouse event on the target
 */
function fire(hit, type, init) {
    const make = type.startsWith('pointer') ? hit.win.PointerEvent : hit.win.MouseEvent;
    hit.el.dispatchEvent(new make(type, init));
}

/*
 * fire_touch(hit, type) -> false if the page cancelled the touch event
 */
function fire_touch(hit, type) {
    try {
        const point = new hit.win.Touch({
            identifier: 1, target: hit.el, clientX: hit.x, clientY: hit.y, pageX: hit.x + hit.win.scrollX, pageY: hit.y + hit.win.scrollY,
            screenX: hit.x + window.screenX, screenY: hit.y + window.screenY, radiusX: 4, radiusY: 4, force: 0.5,
        });
        const down = type !== 'touchend';
        return hit.el.dispatchEvent(new hit.win.TouchEvent(type, {
            bubbles: true, cancelable: true, composed: true, view: hit.win,
            touches: down ? [point] : [], targetTouches: down ? [point] : [], changedTouches: [point],
        }));
    } catch (e) {
        return true; // no touch support in this browser: the pointer and mouse events still go
    }
}

/*
 * tap_at(hit, detail) — a finger tap: touch first, then the mouse events and click a
 *   phone's browser sends after it (skipped when the page cancels the touch)
 */
function tap_at(hit, detail) {
    fire(hit, 'pointerover', mouse_init(hit, 0, 0, 0));
    fire(hit, 'pointerdown', mouse_init(hit, 0, 1, detail));
    fire_touch(hit, 'touchstart');
    focus_target(hit.el);
    fire(hit, 'pointerup', mouse_init(hit, 0, 0, detail));
    const go_on = fire_touch(hit, 'touchend');
    fire(hit, 'pointerout', mouse_init(hit, 0, 0, 0));
    if (!go_on) {
        return;
    }
    fire(hit, 'mouseover', mouse_init(hit, 0, 0, 0));
    fire(hit, 'mousemove', mouse_init(hit, 0, 0, 0));
    fire(hit, 'mousedown', mouse_init(hit, 0, 1, detail));
    fire(hit, 'mouseup', mouse_init(hit, 0, 0, detail));
    fire(hit, 'click', mouse_init(hit, 0, 0, detail));
}

/*
 * focus_target(el) — focus el, or its nearest focusable ancestor
 */
function focus_target(el) {
    let node = el;
    while (node !== null && node !== undefined) {
        if (typeof node.focus === 'function' && (node.tabIndex >= 0 || node.isContentEditable)) {
            node.focus({ preventScroll: true });
            return;
        }
        node = node.parentElement;
    }
}

/*
 * press(hit, button) — move over the target and push a button down
 */
function press(hit, button) {
    const buttons = button === 2 ? 2 : 1;
    fire(hit, 'pointerover', mouse_init(hit, 0, 0, 0));
    fire(hit, 'mouseover', mouse_init(hit, 0, 0, 0));
    fire(hit, 'pointermove', mouse_init(hit, 0, 0, 0));
    fire(hit, 'mousemove', mouse_init(hit, 0, 0, 0));
    fire(hit, 'pointerdown', mouse_init(hit, button, buttons, 1));
    fire(hit, 'mousedown', mouse_init(hit, button, buttons, 1));
    if (button === 0) {
        focus_target(hit.el);
    }
}

/*
 * release(hit, button, detail) — let the button go; a left button also clicks
 */
function release(hit, button, detail) {
    fire(hit, 'pointerup', mouse_init(hit, button, 0, detail));
    fire(hit, 'mouseup', mouse_init(hit, button, 0, detail));
    if (button === 0) {
        fire(hit, 'click', mouse_init(hit, 0, 0, detail));
    } else if (button === 2) {
        fire(hit, 'contextmenu', mouse_init(hit, 2, 0, 1));
    }
}

/*
 * click_at(hit, kind) — 'click', 'double_click' or 'right_click'
 */
function click_at(hit, kind) {
    if (kind === 'right_click') {
        press(hit, 2);
        release(hit, 2, 1);
        return;
    }
    if (is_touch()) {
        tap_at(hit, 1);
        if (kind === 'double_click') {
            tap_at(hit, 2);
            fire(hit, 'dblclick', mouse_init(hit, 0, 0, 2));
        }
        return;
    }
    press(hit, 0);
    release(hit, 0, 1);
    if (kind === 'double_click') {
        press(hit, 0);
        release(hit, 0, 2);
        fire(hit, 'dblclick', mouse_init(hit, 0, 0, 2));
    }
}

/*
 * long_press_at(run, hit, hold_ms) -> Promise; holds the left button down for hold_ms
 */
async function long_press_at(run, hit, hold_ms) {
    if (is_touch()) {
        fire(hit, 'pointerdown', mouse_init(hit, 0, 1, 1));
        fire_touch(hit, 'touchstart');
        await sleep(run, hold_ms, null);
        fire(hit, 'pointerup', mouse_init(hit, 0, 0, 1));
        fire_touch(hit, 'touchend');
        return;
    }
    press(hit, 0);
    await sleep(run, hold_ms, null);
    release(hit, 0, 1);
}

/*
 * set_value(el, value) — set a form field's value the way typing does, so frameworks
 * that watch the field (React, Vue, …) notice
 */
function set_value(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

/*
 * deep_focus(doc) -> the element that really has the focus: through same-origin iframes
 *   and open shadow roots; null when it is the page itself or one of followMe's layers
 */
function deep_focus(doc) {
    let el = doc.activeElement;
    while (el !== null) {
        if (own_layers.indexOf(el) >= 0) {
            return null;
        }
        if ((el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
            let inner = null;
            try {
                inner = el.contentDocument;
            } catch (e) {
                inner = null;
            }
            if (inner === null || inner.activeElement === null) {
                return el;
            }
            el = inner.activeElement;
        } else if (el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        } else {
            break;
        }
    }
    return el === null || el === el.ownerDocument.body || el === el.ownerDocument.documentElement ? null : el;
}

/*
 * typable(el) -> true if text can be typed into el
 */
function typable(el) {
    return el !== null && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

/*
 * key_init(key) -> the init dictionary of a keyboard event for key
 */
function key_init(key) {
    const code = KEY_CODES[key] !== undefined ? KEY_CODES[key] : key.toUpperCase().charCodeAt(0);
    let name = key;
    if (key.length === 1) {
        name = /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : (/[0-9]/.test(key) ? `Digit${key}` : (key === ' ' ? 'Space' : ''));
    }
    return { key: key, code: name, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true };
}

/*
 * insert_char(field, ch) — type one character the way a key press does: keydown,
 *   keypress, beforeinput, the new value, input, keyup (skipped if the page cancels it)
 */
function insert_char(field, ch) {
    const win = field.ownerDocument.defaultView;
    const init = key_init(ch);
    if (!field.dispatchEvent(new win.KeyboardEvent('keydown', init))) {
        field.dispatchEvent(new win.KeyboardEvent('keyup', init));
        return;
    }
    field.dispatchEvent(new win.KeyboardEvent('keypress', init));
    const before = new win.InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true, composed: true });
    if (field.dispatchEvent(before)) {
        if (field.isContentEditable) {
            field.ownerDocument.execCommand('insertText', false, ch);
        } else {
            const proto = field.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, field.value + ch);
            field.dispatchEvent(new win.InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true, composed: true }));
        }
    }
    field.dispatchEvent(new win.KeyboardEvent('keyup', init));
}

/*
 * type_into(run, field, text, step) -> Promise; types text into field as the step says
 *   (clear first, key by key or all at once, Enter after)
 */
async function type_into(run, field, text, step) {
    if (!typable(field)) {
        throw new Error(`Nothing to type into: the focus is on ${describe_target(field)}.`);
    }
    if (typeof field.focus === 'function') {
        field.focus({ preventScroll: true });
    }
    const doc = field.ownerDocument;
    if (step.clear_first) {
        if (field.isContentEditable) {
            doc.execCommand('selectAll', false, null);
            doc.execCommand('delete', false, null);
        } else if (field.value !== '') {
            set_value(field, '');
        }
    }
    if (step.type_mode === 'keys') {
        for (const ch of Array.from(text)) {
            if (run !== null && run.stopped) {
                return;
            }
            insert_char(field, ch);
            await sleep(run, with_jitter(to_number(step.key_delay_ms, 60), to_number(step.key_delay_ms, 60) / 2), null);
        }
        if (!field.isContentEditable) {
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } else if (field.isContentEditable) {
        doc.execCommand('insertText', false, text);
    } else {
        set_value(field, field.value + text);
    }
    if (step.enter_after) {
        press_key_on(field, 'Enter');
    }
}

let last_page_focus = null;   // the page's last focused element, while followMe's panel has the focus

/*
 * watch_focus() — remember which element of the page last had the focus, so "type into
 *   the focused field" still works after a click on followMe's panel (▶ Test this step)
 */
function watch_focus() {
    document.addEventListener('focusin', function () {
        const el = deep_focus(document);
        if (el !== null) {
            last_page_focus = el;
        }
    }, true);
}

/*
 * focused_field() -> the field that has the focus (or had it before followMe's panel
 *   took it); throws when there is none
 */
function focused_field() {
    let el = deep_focus(document);
    if (el === null && last_page_focus !== null && last_page_focus.isConnected) {
        el = last_page_focus;
    }
    if (el === null) {
        throw new Error('No field has the focus. Add a click on the field before this step, or set "Type into" to the field at a point.');
    }
    return el;
}

/*
 * type_at(run, hit, text, step) -> Promise; click the field at the point, then type
 */
async function type_at(run, hit, text, step) {
    click_at(hit, 'click');
    let field = deep_focus(hit.el.ownerDocument);
    if (!typable(field)) {
        field = hit.el;
    }
    if (!typable(field)) {
        throw new Error(`Nothing to type into at that spot (found ${describe_target(field)}).`);
    }
    await type_into(run, field, text, step);
}

const READ_LIMIT = 10000;   // longest text a 'read' step keeps

/*
 * read_at(hit, pattern) -> the text at the point: a field's value or the words shown,
 *   cut down to the first group (or the whole match) of pattern when one is given
 */
function read_at(hit, pattern) {
    const el = hit.el;
    let text = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        text = el.value;
    } else {
        text = el.innerText || el.textContent || el.getAttribute('aria-label') || el.alt || '';
    }
    text = text.replace(/\s+/g, ' ').trim().slice(0, READ_LIMIT);
    if (pattern) {
        const m = regex_of(pattern).exec(text);
        if (m === null) {
            throw new Error(`The text there ("${text.length > 60 ? `${text.slice(0, 60)}…` : text}") doesn't match ${pattern}.`);
        }
        text = m[1] !== undefined ? m[1] : m[0];
    }
    return text;
}

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ' ': 32 };

/*
 * press_key_on(el, key) — key down, press and up on el. Enter that the page doesn't
 *   handle itself (doesn't cancel) submits the field's form, as a real Enter would —
 *   untrusted key events don't do that by themselves. A search box like Google's is a
 *   <textarea> in a form, so that counts too.
 */
function press_key_on(el, key) {
    const win = el.ownerDocument.defaultView;
    const init = key_init(key);
    const down = el.dispatchEvent(new win.KeyboardEvent('keydown', init));
    if (key.length === 1 || key === 'Enter') {
        el.dispatchEvent(new win.KeyboardEvent('keypress', init));
    }
    el.dispatchEvent(new win.KeyboardEvent('keyup', init));
    if (down && key === 'Enter' && el.form && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.form.requestSubmit();
    }
}

/*
 * press_key(key) — press key on whatever has the focus (the page, if nothing has)
 */
function press_key(key) {
    const el = deep_focus(document);
    press_key_on(el === null ? document.body : el, key);
}

/*
 * scroll_at(hit, dx, dy) — scroll the nearest scrollable box under the point, or the page
 */
function scroll_at(hit, dx, dy) {
    let node = hit === null ? null : hit.el;
    while (node !== null && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const can_y = dy !== 0 && /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        const can_x = dx !== 0 && /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
        if (can_y || can_x) {
            node.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
            return;
        }
        node = node.parentElement;
    }
    window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
}

/*
 * bring_into_view(step) -> { x, y } of the step's point, scrolling the page first when a
 * 'page' point is off screen
 */
function bring_into_view(step) {
    let point = step_point(step, view_now());
    if (step.place === 'page' && (point.x < 0 || point.y < 0 || point.x >= window.innerWidth || point.y >= window.innerHeight)) {
        window.scrollTo({ left: step.scroll_x, top: step.scroll_y, behavior: 'instant' });
        point = step_point(step, view_now());
    }
    return point;
}

/*
 * do_action(run, step) -> Promise of the text read by a 'read' step, else undefined;
 *   performs the step's action once ('side' steps are the runner's)
 */
async function do_action(run, step) {
    if (step.action === 'wait' || step.action === 'side') {
        return undefined;
    }
    if (step.action === 'key') {
        press_key(step.key);
        return undefined;
    }
    const text = step.action === 'type' ? fill_vars(step.text, run === null ? null : run.vars) : '';
    if (step.action === 'type' && step.type_into === 'focused') {
        await type_into(run, focused_field(), text, step);
        return undefined;
    }
    const point = bring_into_view(step);
    const hit = hit_at(point.x, point.y);
    if (step.action === 'scroll') {
        scroll_at(hit, to_number(step.scroll_dx, 0), to_number(step.scroll_dy, 0));
        return undefined;
    }
    if (hit === null) {
        throw new Error(`Nothing at (${Math.round(point.x)}, ${Math.round(point.y)}): the point is outside the page.`);
    }
    if (step.action === 'read') {
        return read_at(hit, step.read_pattern);
    }
    if (step.action === 'long_press') {
        await long_press_at(run, hit, step.hold_ms);
    } else if (step.action === 'type') {
        await type_at(run, hit, text, step);
    } else {
        click_at(hit, step.action);
    }
    return undefined;
}
