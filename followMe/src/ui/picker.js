'use strict';
/*
 * Marking a pixel: a see-through layer over the whole page with a crosshair that
 * follows the pointer and shows the coordinates and what is under them. A click there
 * marks the point (the page itself is not clicked); Esc cancels.
 */

let picking = null;   // the open picker's finish function, or null

/*
 * pick_point(number) -> Promise<{ x, y } | null>; number is shown as "Click <number>"
 */
function pick_point(number) {
    if (picking !== null) {
        picking(null);
    }
    return new Promise(function (resolve) {
        const layer = layer_create('picker', PICKER_CSS);
        const hline = h('div', { class: 'hline' });
        const vline = h('div', { class: 'vline' });
        const info = h('div', { class: 'info' }, 'Move to the spot');
        const overlay = h('div', { class: 'picker' }, hline, vline, info,
            h('div', { class: 'banner' }, `Click where Click ${number} should go · Esc to cancel`));
        layer.root.append(h('div', { class: 'fm' }, overlay));

        /*
         * finish(point) — close the picker and answer
         */
        function finish(point) {
            picking = null;
            document.removeEventListener('keydown', on_key, true);
            layer_remove(layer);
            resolve(point);
        }

        /*
         * on_key(event) — Esc cancels
         */
        function on_key(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(null);
            }
        }

        overlay.addEventListener('pointermove', function (event) {
            const x = event.clientX;
            const y = event.clientY;
            hline.style.top = `${y}px`;
            vline.style.left = `${x}px`;
            const hit = hit_at(x, y);   // the picker layer itself is skipped
            info.replaceChildren(h('b', null, `(${Math.round(x)}, ${Math.round(y)})`), ' ', describe_target(hit === null ? null : hit.el));
            const right = x + 340 > window.innerWidth;
            info.style.left = right ? '' : `${x + 14}px`;
            info.style.right = right ? `${window.innerWidth - x + 14}px` : '';
            info.style.top = `${Math.min(y + 14, window.innerHeight - 50)}px`;
        });
        overlay.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            finish({ x: event.clientX, y: event.clientY });
        });
        overlay.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            finish(null);
        });
        document.addEventListener('keydown', on_key, true);
        picking = finish;
    });
}
