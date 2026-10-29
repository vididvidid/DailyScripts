# Daily Scripts ;-D

These are some utilities I found myself needing and found useful, so I created them. 
Why scripts: Because i found mostly myself in browser or in terminal. That's all where i live most of my time. 


## Layout

Each script lives in its own folder, with its docs next to it:

```
<name>/<name>.js     the script (its own ==UserScript== header)
<name>/README.md     what it does and how to use it
followMe/            bigger, so split into src/ and built into followMe/followMe.moss
template.js          starting point for a new script + the live-reload notes
bookmarklet.html     packs any script here into a bookmarklet (for mobile)
```

## Scripts Included

### 1. AiUtils — [`AiUtil/`](AiUtil/) · [full docs](AiUtil/README.md)
A dock for ChatGPT, Claude, Copilot, Gemini and Grok. Keeps a Gist-synced
library of your prompts (with a quick dock over the chat input box so a prompt
is one click away), exports conversations to Markdown or JSON, and squeezes text
down with a minifier, a JSON→TOON converter and Snapcompact. Can also be packed
into a bookmarklet for mobile — see [`bookmarklet.html`](bookmarklet.html).

### 2. YouTube Notes — [`youtubenotes/`](youtubenotes/) · [full docs](youtubenotes/README.md)
A tool for using YouTube deliberately instead of falling into it. Write notes on
videos and Shorts and see them over the thumbnail everywhere; get a giant `❌`
over anything you have already watched, with the player blocked until you confirm
you meant it. "Watched" is not just this browser: it syncs your real YouTube
watch history (so your phone counts, and every signed-in account), and shares one
watched list across all of your machines through a secret GitHub Gist — set up
with one drag-anywhere button and a token. Short videos and Shorts also cost you
one question when you leave them — what was that, and why did you watch it —
behind a deliberate three-second pause, with the buttons moved every time so it
never becomes muscle memory.

### 3. WhatsApp Rotate — [`whatsappRotate/`](whatsappRotate/)
WhatsApp Web's image viewer has no rotate button. This adds rotate left / right
buttons to the viewer's top toolbar, plus `R` / `Shift+R` shortcuts. A photo
taken sideways is scaled up to fill the viewer once it's turned, and each photo
keeps its rotation while you page through the album. Zoom still works on a
rotated photo. The file has its own `==UserScript==` header, so you can paste it
straight into Tampermonkey or load it through the `template.js` stub.

[Full docs →](whatsappRotate/README.md)

### 4. tinkatuff — [`tinkatuff/`](tinkatuff/)
A quantum-exposure scanner for any live website. A small floating button
(drag it anywhere — the spot is remembered) grades the site A–F on what a
future quantum computer could break. Click it and the report opens with a
**plain-language summary**: one line per problem, grouped as *broken today*,
*can be recorded now and unlocked later*, *could be faked later*, *other weak
spots* and *already safe*. Click a line to jump to its detailed card — what
was found, **where** (script + line, request, storage key, console call), and
what to migrate to. Light and dark themes (auto follows the system), and the
logo is a built-in hammer or any picture you pick in Settings (stored in
Tampermonkey, not in the file). **✨ Copy for AI** puts the whole result on the clipboard as a ready-made
prompt — paste it into ChatGPT, Claude or Gemini to get each gap explained,
how quantum computers affect it, and a prioritised fix plan (tokens, keys and
stored values stay redacted). Tabs:

[Full docs →](tinkatuff/README.md)

### 5. monk — [`monk/`](monk/)
Loads any website the minimal way, for slow internet — the way Gmail's old
"basic HTML" view did. A small `M · Lite` / `M · Static` pill in the bottom-left
corner (or `Alt+Shift+M`) opens the settings; each site remembers its own mode.

[Full docs →](monk/README.md)

### 6. Gmail OTP autofill — [`gmailOtp/`](gmailOtp/)
Fills in email OTP codes without an API or token — it uses the Gmail you are
already signed in to in the same browser. When a page shows an OTP box (a
`one-time-code` field, a row of single-digit boxes, or a code/OTP field next
to "verification code" text) and says the code went to your email, it reads
Gmail's Atom feed (your unread inbox as a small XML list) every 2 seconds and
picks the code out of the newest mail that arrived after the page appeared —
usually in about a second, with no tab. Only if the feed fails, or no preview
has a code after 20 seconds, does it open Gmail in a tab (in front — Chrome
won't draw Gmail in a hidden tab), open the mail there, and close the tab
again, landing you back on your page. That tab opens as `?monk=lite`, so with
monk installed Gmail loads without images, fonts or third-party scripts.
*Experimental* (Tampermonkey menu → "Gmail beside the page"): instead of a
tab, Gmail opens in a narrow window beside your page, so you never leave it
(browsers' own split view can't be opened by a script; if the popup is
blocked, a button opens it with one click). If the page mentions SMS or isn't sure, a **📩 Get code from Gmail**
button waits for your click instead.

[Full docs →](gmailOtp/README.md)

### 7. Fire button — [`fireButton/`](fireButton/)
DuckDuckGo's Fire button for any Chromium browser. Two commands in the toolbar
popup: **🔥 Burn this tab** closes the tab you're on and wipes that site's
cookies, storage, cache and history entries; **🔥 Burn all** closes every tab
and wipes all browsing data (history, downloads list, cookies, cache, site
storage, form data), leaving one fresh tab. Needs **Moss** rather than
Tampermonkey: it's a background script that uses the browser's own
`browsingData`, `history` and `tabs` APIs, which Tampermonkey scripts can't reach.
Paste the file into Moss (**+ Script**) and accept the permissions it asks for.

[Full docs →](fireButton/README.md)

### 8. Codeforces ICPC Print — [`codeforcesPrint/`](codeforcesPrint/)
Prints one Codeforces problem on A4 portrait, ICPC style, from a print icon next to
the problem title. Works on problemset, contest, gym and group problem pages.

[Full docs →](codeforcesPrint/README.md)

### 9. followMe — [`followMe/`](followMe/)
Tap-by-pixel automation for any website, like an Android auto-tapper for the browser.
You mark points on the page instead of finding ids, and chain them into an activity:
click here, pause, wait until the page has fully loaded or the URL changed, then click
there. A side panel lists each site's activities. Each click shows where it is on the
screen, what it does and how, with numbered marks on the page that you can drag. It
plays, loops, and carries on after a click loads a new page. Written in Moss's `.moss`
format, so it needs **Moss**.

[Full docs →](followMe/README.md)

## Installation

Every script carries its own header, so each file installs as it is. All of them use
`==UserScript==` except `followMe/followMe.moss`, which is in Moss's own `.moss` format.
Each one is `<name>/<name>.js` (for example `youtubenotes/youtubenotes.js`).
They run in [Moss](https://github.com/vididvidid/Moss) (my own userscript manager) or in
[Tampermonkey](https://www.tampermonkey.net/). `fireButton.js` and `followMe.moss` need Moss.

### Moss (recommended)

1. **Install Moss.** Follow its README: load it unpacked and turn on **Allow User Scripts**.
2. **Import everything at once.** Moss dashboard → **Import…** → paste
   `https://github.com/vididvidid/DailyScripts` → tick the scripts → **Import**.
   - Keep **Keep updated automatically** on, and each script follows this repo.
   - Imported scripts start disabled: enable the ones you want.
   - **Imported before the scripts moved into folders?** Their old links
     (`…/AiUtil.js`) no longer exist, so updates fail with "Not found". Re-import the
     repo, or in each script's **Options → Source** unlink it and link the new file
     (`…/AiUtil/AiUtil.js`).
3. **Accept the permissions.** fireButton asks for browsingData/history/tabs when you
   enable it.

Notes:
- **Moss supports what Tampermonkey gave these scripts.**
  - **Page access with GM functions:** youtubenotes and tinkatuff run in the page
    itself (`@sandbox JavaScript`, for page variables and hooks) and still get
    `GM_xmlhttpRequest`, `GM_setValue` and the menu.
  - **Cross-tab value listeners:** gmailOtp's Gmail tab sends the code back to your
    page through them.
  - **Early start:** document-start scripts (monk, tinkatuff) start before the page's
    own scripts, with their settings already loaded.
- **Menu commands** (`GM_registerMenuCommand`) appear in Moss's toolbar popup.

#### Live reload while editing

1. Open the script in the Moss dashboard.
2. Go to **Options → Source → Link a local file…** and pick the file. From Windows
   Chrome that can be `\\wsl.localhost\Ubuntu\home\kali\DailyScripts\youtubenotes\youtubenotes.js`.
3. Moss reloads the script each time you save the file, while a Moss page is open.
   This replaces the old `template.js` + `@require file://` stub; see `template.js`.

### Tampermonkey

1. **Install Tampermonkey**, open **Create a new script…**, and paste a whole file.
2. **For live reload from your local copy:**
   - Allow **access to file URLs** for Tampermonkey in `chrome://extensions`.
   - In its Settings, set **Config mode → Advanced** and allow scripts to access
     local files (**Externals → Always**).
   - Add `// @require file:///path/to/DailyScripts/<name>/<name>.js` to an empty script
     (see `template.js`).

- Made by: me and other engineers (whose projects I used or part of code I used)
- AI used: Gemini, Claude
- Tool used: Vim
- AI tool: agy

## License
MIT License
