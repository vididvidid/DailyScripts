'use strict';
/*
 * Points that follow the page. A pixel alone breaks as soon as the layout moves: a
 * narrower window (pinning the side panel), a banner that appears, a centred page in a
 * different window size. So when you mark a point, followMe also notes the element
 * drawn there and where inside it you clicked (as a share of its width and height).
 * When the step plays it finds that element again and clicks the same spot inside it,
 * wherever the layout put it. You still only mark pixels; this happens by itself.
 *
 * Finding the element again, in order:
 *   1. its path from the nearest element with a stable id ("#main > div:nth-of-type(2) > button")
 *      — if the element there is still the same kind and says the same thing
 *   2. an element of the same kind saying the same thing (label, then text), the one
 *      nearest to where the point was
 *   3. the element at the path even if its text changed (a counter, a price)
 *   4. none: the marked pixel itself
 *
 * struct anchor {
 *     path: string;     CSS path from the nearest stable id (or the body)
 *     tag: string;      "button"
 *     text: string;     its words, up to 80 characters
 *     label: string;    aria-label / placeholder / name / title / alt
 *     fx, fy: number;   where inside it the point is, 0..1 of its width and height
 *     x, y: number;     the point in the window when it was marked
 * }
 * struct found { x, y: number; el: Element | null; how: 'path' | 'text' | 'moved' | 'pixel' }
 */

const ANCHOR_TARGETS = 'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [onclick], [tabindex]';
const ANCHOR_SEARCH_LIMIT = 3000;   // elements of one kind looked at when the path fails

/*
 * top_element_at(x, y) -> the page's own element at (x, y) in the top document (an
 *   iframe counts as one element), skipping followMe's layers
 */
function top_element_at(x, y) {
    const saved = [];
    for (const layer of own_layers) {
        saved.push(layer.style.visibility);
        layer.style.visibility = 'hidden';
    }
    try {
        return document.elementFromPoint(x, y);
    } finally {
        for (let i = 0; i < own_layers.length; i++) {
            own_layers[i].style.visibility = saved[i];
        }
    }
}

/*
 * stable_id(el) -> el's id if it is unique and doesn't look generated, else ''
 */
function stable_id(el) {
    const id = el.id;
    if (!id || /\d{4,}|^[a-f0-9-]{12,}$|^(ember|react|vue|ng|mui|radix|headlessui)[-_:]/i.test(id) || id.indexOf(':') >= 0) {
        return '';
    }
    try {
        return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1 ? id : '';
    } catch (e) {
        return '';
    }
}

/*
 * css_path(el) -> "#main > div:nth-of-type(2) > button:nth-of-type(1)"
 */
function css_path(el) {
    const parts = [];
    let node = el;
    while (node !== null && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
        const id = stable_id(node);
        if (id !== '') {
            parts.unshift(`#${CSS.escape(id)}`);
            return parts.join(' > ');
        }
        let n = 1;
        let sib = node.previousElementSibling;
        while (sib !== null) {
            if (sib.tagName === node.tagName) {
                n++;
            }
            sib = sib.previousElementSibling;
        }
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${n})`);
        node = node.parentElement;
    }
    parts.unshift('body');
    return parts.join(' > ');
}

/*
 * text_of(el) -> el's words, squeezed, up to 80 characters
 */
function text_of(el) {
    const raw = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? '' : (el.innerText || el.textContent || '');
    return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/*
 * label_of(el) -> what el is called besides its text
 */
function label_of(el) {
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0, 80);
}

/*
 * anchor_at(x, y) -> struct anchor for the point, or null when there is nothing to hold
 *   on to (the bare page, or something huge)
 */
function anchor_at(x, y) {
    let el = top_element_at(x, y);
    if (el === null || el === document.body || el === document.documentElement) {
        return null;
    }
    const target = el.closest(ANCHOR_TARGETS);
    if (target !== null && target !== document.body) {
        el = target;
    }
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || (box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.9)) {
        return null; // a whole-page box says nothing about where the point is
    }
    return {
        path: css_path(el),
        tag: el.tagName.toLowerCase(),
        text: text_of(el),
        label: label_of(el),
        fx: clamp((x - box.left) / box.width, 0, 1),
        fy: clamp((y - box.top) / box.height, 0, 1),
        x: Math.round(x),
        y: Math.round(y),
    };
}

/*
 * same_words(el, a) -> true if el is called / says what the anchor noted
 */
function same_words(el, a) {
    if (a.label !== '') {
        return label_of(el) === a.label;
    }
    if (a.text !== '') {
        return text_of(el) === a.text;
    }
    return true;
}

/*
 * shown(el) -> true if el takes up space on the page
 */
function shown(el) {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
}

/*
 * find_anchor(a) -> { el, how } for the element the anchor describes, or { el: null }
 */
function find_anchor(a) {
    let at_path = null;
    try {
        at_path = document.querySelector(a.path);
    } catch (e) {
        at_path = null;
    }
    if (at_path !== null && at_path.tagName.toLowerCase() === a.tag && same_words(at_path, a) && shown(at_path)) {
        return { el: at_path, how: 'path' };
    }
    if (a.label !== '' || a.text !== '') {
        const all = document.getElementsByTagName(a.tag);
        let best = null;
        let best_d = Infinity;
        for (let i = 0; i < all.length && i < ANCHOR_SEARCH_LIMIT; i++) {
            const el = all[i];
            if (!same_words(el, a) || !shown(el)) {
                continue;
            }
            const box = el.getBoundingClientRect();
            const d = Math.hypot(box.left + box.width * a.fx - a.x, box.top + box.height * a.fy - a.y);
            if (d < best_d) {
                best = el;
                best_d = d;
            }
        }
        if (best !== null) {
            return { el: best, how: 'text' };
        }
    }
    if (at_path !== null && at_path.tagName.toLowerCase() === a.tag && shown(at_path)) {
        return { el: at_path, how: 'moved' };
    }
    return { el: null, how: 'pixel' };
}

/*
 * point_of(step) -> struct found: where the step acts now
 */
function point_of(step) {
    if (step.place === 'element' && step.anchor) {
        const f = find_anchor(step.anchor);
        if (f.el !== null) {
            const box = f.el.getBoundingClientRect();
            return { x: box.left + box.width * step.anchor.fx, y: box.top + box.height * step.anchor.fy, el: f.el, how: f.how };
        }
    }
    const p = step_point(step, view_now());
    return { x: p.x, y: p.y, el: null, how: 'pixel' };
}

/*
 * set_point(step, x, y) — the step now acts at (x, y): its pixel, the view, and (for
 *   'element' points) a fresh anchor
 */
function set_point(step, x, y) {
    const view = view_now();
    step.x = Math.round(x);
    step.y = Math.round(y);
    step.scroll_x = Math.round(view.scroll_x);
    step.scroll_y = Math.round(view.scroll_y);
    step.view_w = view.w;
    step.view_h = view.h;
    step.anchor = step.place === 'element' ? anchor_at(x, y) : null;
}

/*
 * describe_found(step) -> "button "Checkout" — found where it was" for the detail view
 */
function describe_found(step) {
    if (step.place !== 'element') {
        return '';
    }
    if (!step.anchor) {
        return 'Nothing to follow at that spot (the bare page), so it uses the pixel.';
    }
    const f = find_anchor(step.anchor);
    const what = `${step.anchor.tag}${step.anchor.label ? ` "${step.anchor.label}"` : (step.anchor.text ? ` "${step.anchor.text.slice(0, 40)}"` : '')}`;
    const how = {
        path: 'found ✓',
        text: 'found by its words ✓ (it moved in the page)',
        moved: 'found where it was, but its words changed',
        pixel: 'not on the page now: it uses the marked pixel',
    };
    return `Follows ${what} — ${how[f.how]}.`;
}
