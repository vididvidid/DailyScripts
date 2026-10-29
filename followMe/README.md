# followMe (`followMe.moss`)

Tap-by-pixel automation for any website, as a [Moss](https://github.com/vididvidid/Moss) script —
like Android's auto-tapper apps, for the browser.

No Puppeteer, no selectors, no ids. You **mark a point on the page**; followMe clicks
whatever is drawn at that pixel. Chain marks into an **activity** with a break between
clicks, and attach checks to them — *wait until the page has fully loaded*, *wait until
the URL changed* — which is what single-page apps need, because they change the page
without reloading it.

## Install

1. Install [Moss](https://github.com/vididvidid/Moss) and turn on **Allow User Scripts**.
2. Moss dashboard → **Import…** → paste
   `https://github.com/vididvidid/DailyScripts/blob/main/followMe/followMe.moss` → **Import**, then enable it.
   (Importing the whole DailyScripts repo lists it too.)

It runs on every site, top frame only. A small orange **followMe** tab sits on the edge of
the window. Click it, or press **Alt+Shift+P**, to open the side panel.

## Using it

1. **＋ New activity** → name it. followMe hides its panel and shows a crosshair with the
   pixel coordinates and what is under them. Click the spot for **Click 1**. Esc cancels.
2. **＋ Add click (mark on page)** for each next click. Each one gets a numbered mark on the
   page, and the marks are joined in play order. Drag a mark to move its click.
3. Open a step to set it up:

| section | what you set |
|---|---|
| **Where on the screen** | the pixel (x, y), a small map of the window with the point on it, **📍 Mark again**, what is at that pixel right now (`button "Checkout"`), and how the point follows the page: **same spot on the screen**, **on the page** (follows scrolling; it scrolls there first), or **relative to the window size** |
| **What it does** | left / double / right click, long press, type text (optionally clearing the field first), press a key, scroll, or only wait; repeat it *n* times with a gap |
| **How** | a plain description of the events it sends |
| **Before it, wait until** / **After it, wait until** | **Page fully loaded**, **URL changed**, **URL matches** `*glob*` or `/regex/`, **Wait a fixed time**. Each has a time limit and either *stop* or *go on* when that runs out |
| **Then pause** | the break before the next step, plus an optional random ± so the timing isn't robotic |

4. **▶ Play** runs it, **■ Stop** or **Esc** stops it. **Loops** repeats the whole activity
   (0 = until stopped), with a pause between loops. **▶ Test this step** does only that
   step's action, and **▶ Play from here** starts at that step.

The status bar shows what it is doing, for example "Checkout: waiting until the URL has
changed · 12 s". The step that is playing is outlined, and its mark pulses.

### The checks

- **Page fully loaded:** the document reports `complete`, then nothing new is
  downloaded and nothing on the page changes for 0.7 s. An app that draws its content
  after `load` only counts as loaded once it settles.
- **URL changed:** the address differs from the one just before the action, or, as a
  "before" check, from the one before the previous action. Single-page apps change the
  address without reloading, so followMe watches it.
- **URL matches:** a `*` glob or a `/regex/` against the full address.

### Clicks that load a new page

A click that navigates ends the script on that page. followMe saves the run for that
tab just before every action. On the next page it carries on with that step's "after"
checks, and **URL changed** is then already true. This is kept per tab and expires
after two minutes.

### Keeping and sharing

Activities are stored in Moss (`GM_setValue`) and listed per site. **Runs on** sets
which pages an activity is for (default: the whole site). **Export / import** gives
this site's activities as JSON.

## How a click works, and its limits

followMe asks the browser what is drawn at the pixel (`elementFromPoint`, also inside
same-origin iframes). It then sends that element the events a real click makes:
pointer and mouse over, move, down, focus, up, click (plus `dblclick` or
`contextmenu`). Canvas apps and games get the click at the right coordinates too.

Typing sets the field's value the way a keystroke does, so React and Vue notice. Enter
in a form field submits the form.

What a userscript can't do:
- The events are **untrusted** (`event.isTrusted === false`). Most sites accept them, but
  a few check, and those ignore the click.
- **Cross-origin iframes** (payment boxes, captchas) can't be clicked into.
- Pixels depend on the layout. Use *on the page* or *relative to the window size* when
  the layout scrolls or resizes, and give a slow page a **Page fully loaded** check.

## Developing

Unlike the other DailyScripts, followMe is split into small files and built into the
one installable file. Everything below lives in this folder; run the commands from here.

```
src/header.moss        the Moss header
src/core/util.js       helpers (sleep that a stop wakes, globs, ids)
src/core/steps.js      activities, steps, checks, and their plain-language descriptions
src/core/store.js      GM storage, per-tab run state for resuming
src/core/checks.js     page loaded / URL changed / URL matches / wait
src/core/clicker.js    pixel → element, pointer/mouse/key events, typing, scrolling
src/core/runner.js     playing, loops, pauses, stop, resume after a page load
src/ui/                styles, DOM helpers, the pixel picker, the marks, the panel
src/main.js            start-up: edge tab, Alt+Shift+P, Esc, menu commands, resume
tools/build.mjs        joins them, in order, into followMe.moss
```

The files are joined like C translation units: each one declares plain functions, and
later files call earlier ones. Edit `src/`, then:

```sh
npm run build   # write followMe.moss
npm test        # core behaviour (runner, checks, resume, storage) + the style checker
npm run check   # followMe.moss is up to date, every file parses
```

The code follows [STYLE.md](STYLE.md): strict, C-style JavaScript, the same as Moss.

## License
MIT, like the rest of [DailyScripts](../README.md).
