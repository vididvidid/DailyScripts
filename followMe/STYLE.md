# followMe style

followMe is written the way [Moss](https://github.com/vididvidid/Moss/blob/main/STYLE.md) is:
strict-mode, C-style JavaScript. `tests/style.test.js` (the same checker) enforces it.

- `'use strict';` first in every file. The build drops it from each part, because the
  whole `.moss` script runs strict.
- Names are `snake_case`; constants are `UPPER_SNAKE`. Names we don't own keep their
  spelling (`addEventListener`, `GM_getValue`).
- Every function is a named declaration with a `name(args) -> result` comment.
  No arrow functions.
- Use plain `for` loops: no `map`, `filter`, `reduce`, `forEach`, `some`, `every` or `find`.
- Braces on every `if`, `else`, `for` and `while`. Indent 4 spaces.
- `const` / `let`, never `var`. No `?.` or `??`.
- Data is plain objects, with their shape written as a `struct` comment where they are
  defined. No classes, no `this`.
