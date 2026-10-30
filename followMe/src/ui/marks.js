'use strict';
/*
 * The numbered marks: one circle per step at the pixel it acts on, joined by a dashed
 * line in play order, like an auto-tapper's targets. Drag a mark to move its step.
 * The playing step pulses.
 *
 * struct marks (one, below) {
 *     layer: struct layer | null;
 *     activity: struct activity | null;   shown, or null for none
 *     selected: number;                   step open in the panel, or -1
 *     active: number;                     step being played, or -1
 *     on_move(index, x, y);               a mark was dragged to (x, y)
 *     frame: number;                      pending animation frame, or 0
 *     drawn: string;                      what is on screen, to skip redrawing the same
 * }
 */

const marks = { layer: null, activity: null, selected: -1, active: -1, on_move: null, frame: 0, drawn: '' };

/*
 * marks_set(activity, selected, on_move) — show these marks (activity null hides them)
 */
function marks_set(activity, selected, on_move) {
    marks.activity = activity;
    marks.selected = selected;
    marks.on_move = on_move;
    marks_render();
}

/*
 * marks_active(index) — highlight the step being played (-1: none)
 */
function marks_active(index) {
    if (marks.active !== index) {
        marks.active = index;
        marks_render();
    }
}

/*
 * marks_render_soon() — redraw once before the next frame (scrolling, resizing)
 */
function marks_render_soon() {
    if (marks.frame === 0 && marks.activity !== null) {
        marks.frame = requestAnimationFrame(function () {
            marks.frame = 0;
            marks_render();
        });
    }
}

/*
 * drag_mark(el, index, event) — move a mark with the pointer, then report where it landed
 */
function drag_mark(el, index, event) {
    event.preventDefault();
    event.stopPropagation();
    el.setPointerCapture(event.pointerId);
    el.classList.add('dragging');

    /*
     * on_move(e) — follow the pointer
     */
    function on_move(e) {
        el.style.left = `${e.clientX}px`;
        el.style.top = `${e.clientY}px`;
    }

    /*
     * on_up(e) — drop the mark
     */
    function on_up(e) {
        el.removeEventListener('pointermove', on_move);
        el.removeEventListener('pointerup', on_up);
        el.classList.remove('dragging');
        if (marks.on_move !== null) {
            marks.on_move(index, e.clientX, e.clientY);
        }
    }
    el.addEventListener('pointermove', on_move);
    el.addEventListener('pointerup', on_up);
}

/*
 * marks_render() — draw the marks of the shown activity
 */
function marks_render() {
    if (marks.activity === null) {
        if (marks.layer !== null) {
            layer_remove(marks.layer);
            marks.layer = null;
        }
        return;
    }
    const view = view_now();
    // The same marks in the same place: leave them (no flicker, the pulse keeps going).
    const key = JSON.stringify([marks.activity.steps, marks.selected, marks.active, view]);
    if (marks.layer !== null && key === marks.drawn) {
        return;
    }
    marks.drawn = key;
    if (marks.layer === null) {
        marks.layer = layer_create('marks', MARKS_CSS);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dots = [];
    let prev = null;
    const steps = marks.activity.steps;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step_has_point(step)) {
            continue;
        }
        const p = point_of(step);
        if (prev !== null && step.enabled) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', prev.x);
            line.setAttribute('y1', prev.y);
            line.setAttribute('x2', p.x);
            line.setAttribute('y2', p.y);
            svg.append(line);
        }
        if (step.enabled) {
            prev = p;
        }
        let cls = 'mark';
        if (i === marks.selected) {
            cls += ' selected';
        }
        if (i === marks.active) {
            cls += ' active';
        }
        if (!step.enabled) {
            cls += ' off';
        }
        const index = i;
        const dot = h('div', {
            class: cls,
            title: `${step_title(step, i)}: ${describe_action(step)} — drag to move`,
            style: { left: `${p.x}px`, top: `${p.y}px` },
            on_pointerdown: function (event) {
                drag_mark(dot, index, event);
            },
        }, String(i + 1), h('span', null, step_title(step, i)));
        dots.push(dot);
    }
    marks.layer.root.replaceChildren(h('style', null, BASE_CSS + MARKS_CSS), h('div', { class: 'fm marks' }, svg, dots));
}

window.addEventListener('scroll', marks_render_soon, { passive: true });
window.addEventListener('resize', marks_render_soon);
