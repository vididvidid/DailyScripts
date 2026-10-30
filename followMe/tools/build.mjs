'use strict';
/*
 * Builds followMe.moss: the Moss header, then every source file in the order below,
 * like linking C files: later files call functions that earlier files declare.
 *   node tools/build.mjs           write followMe.moss
 *   node tools/build.mjs --check   fail if followMe.moss is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
export const ORDER = [
    'src/core/util.js',
    'src/core/steps.js',
    'src/core/store.js',
    'src/core/net.js',
    'src/core/device.js',
    'src/core/checks.js',
    'src/core/clicker.js',
    'src/core/runner.js',
    'src/ui/styles.js',
    'src/ui/dom.js',
    'src/ui/picker.js',
    'src/ui/marks.js',
    'src/ui/panel.js',
    'src/main.js',
];
const OUT = 'followMe.moss';

/*
 * read(path) -> text of a repo file
 */
function read(path) {
    return readFileSync(new URL(path, ROOT), 'utf8');
}

/*
 * body_of(path) -> a source file without its own 'use strict' line (a .moss script is
 * strict as a whole)
 */
function body_of(path) {
    return read(path).replace(/^'use strict';\n/, '').trim();
}

/*
 * bundle() -> the text of followMe.moss
 */
export function bundle() {
    const parts = [read('src/header.txt').trim(), '', '// Built by tools/build.mjs from src/ — edit those files, not this one.'];
    for (const path of ORDER) {
        parts.push('', `// ---------- ${path} ----------`, '', body_of(path));
    }
    return `${parts.join('\n')}\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const text = bundle();
    if (process.argv.includes('--check')) {
        if (read(OUT) !== text) {
            console.error(`${OUT} is out of date: run "npm run build".`);
            process.exit(1);
        }
    } else {
        writeFileSync(new URL(OUT, ROOT), text);
        console.log(`wrote ${OUT} (${text.length} bytes)`);
    }
}
