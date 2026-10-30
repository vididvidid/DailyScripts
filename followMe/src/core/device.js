'use strict';
/*
 * Which device the tab is shown as: Moss's GM_device emulates a phone or tablet with
 * Chrome's own device mode (screen size, touch, mobile user agent), so a site serves
 * and draws its mobile layout. Switching reloads the page.
 *
 * struct device_state { mode: 'desktop' | 'mobile' | 'tablet' | 'custom'; orientation: 'portrait' | 'landscape' }
 */

const DEVICES = { desktop: '🖥 Desktop', mobile: '📱 Mobile', tablet: '📲 Tablet' };
const ORIENTATIONS = { portrait: 'Portrait', landscape: 'Landscape' };

let device_current = { mode: 'desktop', orientation: 'portrait' };   // as device_now() last found it

/*
 * device_supported() -> true if this Moss can emulate devices
 */
function device_supported() {
    return typeof GM_device !== 'undefined' && GM_device !== null;
}

/*
 * device_now() -> Promise<struct device_state> of this tab
 */
async function device_now() {
    let state = { mode: 'desktop', orientation: 'portrait' };
    if (device_supported()) {
        const em = await GM_device.get();
        if (em !== null && em !== undefined) {
            state = { mode: em.mode, orientation: em.width > em.height ? 'landscape' : 'portrait' };
        }
    }
    device_current = state;
    return state;
}

/*
 * is_touch() -> true while the tab is shown as a phone or tablet (taps, not clicks)
 */
function is_touch() {
    return device_current.mode !== 'desktop';
}

/*
 * device_matches(state, mode, orientation) -> true if the tab already looks that way
 */
function device_matches(state, mode, orientation) {
    if (mode === 'desktop' || mode === undefined) {
        return state.mode === 'desktop';
    }
    return state.mode === mode && state.orientation === (orientation || 'portrait');
}

/*
 * device_switch(mode, orientation) -> Promise; shows the tab as that device (reloads it)
 */
async function device_switch(mode, orientation) {
    if (!device_supported()) {
        throw new Error('Mobile and tablet views need a Moss with GM_device (Moss 0.2+).');
    }
    if (mode === 'desktop') {
        await GM_device.clear();
    } else {
        await GM_device.set(mode, { orientation: orientation || 'portrait' });
    }
}
