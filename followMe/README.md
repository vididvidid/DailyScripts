# followMe (`followMe.moss`)

Tap-by-pixel automation for any website, as a [Moss](https://github.com/vididvidid/Moss) script —
like Android's auto-tapper apps, for the browser.

No Puppeteer, no selectors, no ids. You **mark a point on the page**; followMe clicks
whatever is drawn at that pixel. Chain marks into an **activity** with a break between
clicks, and attach checks to them — *wait until the page has fully loaded*, *wait until
the URL changed*, *wait until the internet is on* — which is what single-page apps
need, because they change the page without reloading it.

An activity can play the site as a **desktop, mobile or tablet** (real device emulation,
so the site serves its phone layout). A step can also **hand off to another site**: open
it beside the page in Chrome's split view, play an activity there, bring back what it
read, close it, and carry on.

## Install

1. Install [Moss](https://github.com/vididvidid/Moss) 0.2 or later and turn on **Allow User Scripts**.
   (Older Moss runs followMe without the mobile/tablet view or the other-site step.)
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
| **What it does** | left / double / right click, long press, type text (optionally clearing the field first), press a key, scroll, **read text**, **run on another site**, or only wait; repeat it *n* times with a gap |
| **How** | a plain description of the events it sends |
| **Before it, wait until** / **After it, wait until** | **Page fully loaded**, **URL changed**, **URL matches** `*glob*` or `/regex/`, **Internet is on**, **Wait a fixed time**. Each has a time limit and either *stop* or *go on* when that runs out |
| **Then pause** | the break before the next step, plus an optional random ± so the timing isn't robotic |

### Typing (for example, a search on google.com)

1. **＋ Add click (mark on page)** and click the search bar. That is **Click 1**, and it
   puts the cursor in the box.
2. **⌨ Type text**. Because the step before is a click, the new step types into **the
   field that has the focus**, so there's nothing to mark. Write the text in **Text to
   type**.
3. Tick **Press Enter after typing** to run the search. Add an **After it, wait until →
   URL changed** (or **Page fully loaded**) before the next click on the results.

A Type text step can also have its own point instead (**Into → the field at a point**).
It then clicks that field itself, so no separate click is needed. Other options:
- **key by key** (default): keydown, input and keyup for each character, with a short
  random gap, so search boxes show their suggestions.
- **all at once:** sets the whole text in one go.
- **Empty the field first.**
- `{name}` puts in a value read earlier.

Enter that the page doesn't handle itself submits the field's form. Google's search box
is a `<textarea>`, and this covers it.

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

- **Internet is on:** see below.

### Internet on or off

The panel's header shows **● Online** or **● Offline**; click it to check again. The
browser's own "online" flag only says the computer is on a network, and Wi-Fi without
internet still counts as online. So followMe also asks a tiny page on the internet
(`https://www.gstatic.com/generate_204`) through Moss.

Each activity has **Only play with internet** (on by default). It is checked before
every step. When the internet is off, the run either **waits for it to come back** (the
status bar says so, and it carries on by itself) or **stops**. Turn it off for a site
on your own network. The **Internet is on** check does the same for a single step,
with its own time limit.

### Desktop, mobile or tablet

**View as** on an activity picks 🖥 Desktop, 📱 Mobile (412×915) or 📲 Tablet (800×1280),
in portrait or landscape. Moss uses Chrome's own device mode (the one in DevTools) on
that tab: the screen size, the pixel ratio, touch input, and an Android user agent the
server sees too. The site therefore serves and draws its real phone or tablet layout,
not a squeezed desktop page.

- **Show it now** switches the tab while you edit, so you mark points on that layout.
  The page reloads.
- **▶ Play** switches the tab first if needed (it reloads, then the run starts).
- On a phone or tablet view, a click is a **tap**: touch pointer events,
  `touchstart` / `touchend`, then the mouse events and click a phone sends.
- Chrome shows a bar saying Moss "started debugging this browser" while a tab is
  emulated. Clicking **Cancel** on it ends the emulation, and a run that needs it stops
  with a message. To go back, pick **Desktop** and **Show it now**.
- At phone width the panel turns into a sheet at the bottom of the page. Better: pin it
  to the side (below), where it keeps its full size.

### Reading values, and other sites in split view

**Read text** is a point step. It takes the text at that pixel (a field's value, or the
words shown) and keeps it as `{answer}`, or any name you give it. An optional
`/regex/` keeps only part of the text: `/([\d,]+)/` turns "Rs 1,499 only" into `1,499`.
Later steps use it by name. For example, a **Type text** of `{price} minus 10%`. Values
last for the whole run, across page loads.

**Run on another site** goes to a different website mid-activity. For example, steps 1
and 2 happen here, then you need an answer from another site, then the activity
carries on here.

1. First, on the other site, make the activity that gets the answer. End it with a
   **Read text** step for each value you need.
2. Here, add **＋ Other step… → Run on another site (split view)**. Pick that activity,
   and optionally the page to open. `{name}` works in the address, for example
   `https://example.com/search?q={item}`.
3. When it plays, Moss opens that page **beside this one**, in Chrome's split view
   (Chrome 155+). On older Chrome, this window narrows and the page opens in a second
   window next to it. followMe on that page plays the activity with the values read so
   far. It then hands back every value it read, the page closes, the window gets its
   size back, and the activity carries on here with those values.

You can choose split view only, a window only, which side, a time limit, and whether to
close the other page when it is done.

### Clicks that load a new page

A click that navigates ends the script on that page. followMe saves the run for that
tab just before every action. On the next page it carries on with that step's "after"
checks, and **URL changed** is then already true. This is kept per tab and expires
after two minutes.

### Pin it to the side

**📌** in the panel's header moves followMe into Chrome's **side panel** (Moss's side
panel). There it sits next to the page instead of over it. It also stays full size when
the tab is shown as a phone or tablet, because device emulation only squeezes the page.
It follows the tab you're on and stays pinned on every page until you click **Unpin**.

Chrome opens the side panel only from a click on the browser itself, so 📌 may ask you
to open it once: use the Moss toolbar button → **Side panel**, or right-click the page →
**Moss side panel**. After that, followMe appears there by itself.

### Saving, backup and gist sync

Every change is kept the moment you make it, so nothing is lost if you forget to save.
A step you changed shows **unsaved** until you press **💾 Save** (on the step, or at the
top of the activity). Save marks it saved and updates the gist.

**☁ Gist** (in the footer) keeps **all activities of all sites** in one private GitHub
gist, with one readable file per activity:

1. Make a [token (classic) with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=followMe)
   and paste it there. Leave the gist id empty: followMe finds your followMe gist, or
   makes a new private one.
2. The gist is updated when you press **Save**, add a step, delete an activity, or
   import. It is read when followMe starts on a page (at most once a minute). Per
   activity, the newer copy wins, and a deletion wins over anything older.
3. The gist's **History** (its revisions) keeps every earlier version: that's your
   backup. **⬇ Download a backup file** saves everything as one JSON file too.
4. On another computer, paste the same token to get the same activities.

The token is kept in Moss's storage for this script.

### Keeping and sharing

Activities are stored in Moss (`GM_setValue`) and listed per site. **Runs on** sets
which pages an activity is for (default: the whole site). **Export / import** gives
this site's activities as JSON. **Delete activity** is at the bottom of an activity.

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
src/header.txt         the Moss header (a .txt, so Moss doesn't list it as a script)
src/core/util.js       helpers (sleep that a stop wakes, globs, ids)
src/core/steps.js      activities, steps, checks, and their plain-language descriptions
src/core/store.js      GM storage, per-tab run state for resuming, other-site job results
src/core/gist.js       GitHub gist sync and backup (one file per activity, merge, deletions)
src/core/net.js        is the internet on (navigator.onLine + a probe through GM_xmlhttpRequest)
src/core/device.js     desktop / mobile / tablet view through Moss's GM_device
src/core/checks.js     page loaded / URL changed / URL matches / internet on / wait
src/core/clicker.js    pixel → element, pointer/mouse/touch/key events, typing, scrolling, reading text
src/core/runner.js     playing, loops, pauses, stop, resume after a page load, device switch,
                       internet gate, other-site steps (GM_split)
src/ui/                styles, DOM helpers, the pixel picker, the marks, the panel
src/main.js            start-up: edge tab, Alt+Shift+P, Esc, menu commands, resume
tools/build.mjs        joins them, in order, into followMe.moss
```

The files are joined like C translation units: each one declares plain functions, and
later files call earlier ones. Edit `src/`, then:

```sh
npm run build   # write followMe.moss
npm test        # core behaviour (runner, checks, resume, storage, values, internet, device, other site) + the style checker
npm run check   # followMe.moss is up to date, every file parses
```

The code follows [STYLE.md](STYLE.md): strict, C-style JavaScript, the same as Moss.

## License
MIT, like the rest of [DailyScripts](../README.md).
