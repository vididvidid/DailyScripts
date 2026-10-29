'use strict';
/*
 * Building followMe's own elements. Each layer (panel, edge tab, marks, picker) is a
 * host element on top of the page with a closed shadow root, so the page's CSS can't
 * restyle it and the page's scripts can't reach into it.
 *
 * struct layer { host: HTMLElement; root: ShadowRoot }
 */

/*
 * append_all(el, children) — append nodes and strings, skipping null/false, flattening arrays
 */
function append_all(el, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) {
            continue;
        }
        if (Array.isArray(child)) {
            append_all(el, child);
        } else {
            el.append(child);
        }
    }
}

/*
 * h(tag, props, ...children) -> a new element
 *   props: class, on_<event> handlers, attributes, properties
 */
function h(tag, props) {
    const el = document.createElement(tag);
    const p = props || {};
    for (const key of Object.keys(p)) {
        const value = p[key];
        if (value === null || value === undefined || value === false) {
            continue;
        }
        if (key.startsWith('on_')) {
            el.addEventListener(key.slice(3), value);
        } else if (key === 'class') {
            el.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(el.style, value);
        } else if (key in el && typeof value !== 'string') {
            el[key] = value;
        } else {
            el.setAttribute(key, value === true ? '' : value);
        }
    }
    append_all(el, Array.prototype.slice.call(arguments, 2));
    return el;
}

/*
 * layer_create(name, css) -> struct layer: a fixed, topmost host with its own styles
 */
function layer_create(name, css) {
    const host = document.createElement('div');
    host.setAttribute('data-followme', name);
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;';
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h('style', null, BASE_CSS + css));
    document.documentElement.append(host);
    register_layer(host);
    return { host: host, root: root };
}

/*
 * layer_remove(layer) — take a layer off the page
 */
function layer_remove(layer) {
    unregister_layer(layer.host);
    layer.host.remove();
}

/*
 * number_field(value, on_change, attrs) -> an <input type=number> that reports numbers
 */
function number_field(value, on_change, attrs) {
    return h('input', Object.assign({
        type: 'number',
        value: String(value),
        on_change: function (event) {
            on_change(to_number(event.target.value, value));
        },
    }, attrs || {}));
}

/*
 * text_field(value, on_change, attrs) -> an <input> that reports its text on change
 */
function text_field(value, on_change, attrs) {
    return h('input', Object.assign({
        type: 'text',
        value: value,
        spellcheck: 'false',
        on_change: function (event) {
            on_change(event.target.value);
        },
    }, attrs || {}));
}

/*
 * select_field(value, options, on_change) -> a <select>; options: { value: label }
 */
function select_field(value, options, on_change) {
    const items = [];
    for (const key of Object.keys(options)) {
        items.push(h('option', { value: key, selected: key === value }, options[key]));
    }
    return h('select', {
        on_change: function (event) {
            on_change(event.target.value);
        },
    }, items);
}

/*
 * seconds_field(ms, on_change) -> a number field in seconds that reports milliseconds
 */
function seconds_field(ms, on_change) {
    return number_field(Math.round(ms) / 1000, function (s) {
        on_change(Math.max(0, Math.round(s * 1000)));
    }, { step: '0.1', min: '0', class: 'secs' });
}
