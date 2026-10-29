# monk (`monk.js`)

Loads any website the minimal way, for slow internet — the way Gmail's old
"basic HTML" view did. A small `M · Lite` / `M · Static` pill in the bottom-left
corner (or `Alt+Shift+M`) opens the settings; each site remembers its own mode.

- **Lite** — the site still works, running only its *own* JavaScript:
  third-party scripts (ads, analytics, trackers, chat widgets) are blocked,
  and images, video, web fonts and third-party frames are never downloaded;
  animations are off. Library CDNs, captchas, sign-in and payment still load,
  and each of these can be let through per site from the panel. Login, captcha and payment frames still load. On YouTube
  video stays on and the player is forced to 144p.
- **Static** — no JavaScript and no CSS at all: just the page's HTML with a
  small readable stylesheet. Every link and form is a plain page load.
  `<noscript>` fallbacks are shown and images become `🖼 alt` placeholders —
  click one to fetch just that image. A page that needs JavaScript (Gmail, a
  dashboard that draws its list from JSON, an empty React root) is reopened
  in Lite automatically and remembered — unless you picked Static for that
  site on purpose.
- **YouTube in Static** is rebuilt from the data YouTube already puts in the
  HTML: a search box, the video list (search, home, channel, playlist,
  related) and the watch page (title, channel, views, description) with
  **▶ Play here** to reopen it once in Lite at 144p. A search page is ~180 KB
  instead of ~4 MB.
- **Auto** (as the default) picks Static on 2G / data-saver, Lite on 3G and Off
  on anything faster. **Full page once** opens the current page normally,
  one time.
- **`?monk=lite`** (or `static` / `off`) in any URL loads that one page in that
  mode — other scripts use it to open a page light.

It works by adding a Content-Security-Policy `<meta>` at `document-start`, so
the browser itself refuses the blocked downloads. It can only make a site
stricter, never looser; a few files the browser starts fetching before any
script can run (the first preloads in `<head>`) may still come through. If
Tampermonkey starts it late, Static strips the page CSS by hand and the panel
shows a warning; Tampermonkey's *Inject Mode: Instant* setting (Advanced
config) avoids that where it's offered. Its
header needs `@run-at document-start` and `@connect *` (for click-to-load
images), so paste it straight into Tampermonkey or give the [`template.js`](../template.js) stub
the same lines.

## Install

The file carries its own `==UserScript==` header, so it installs as it is: in
[Moss](https://github.com/vididvidid/Moss) use **Import…** with this file's GitHub link
(or **+ Script** and paste it); in Tampermonkey paste it into a new script. See the
[installation guide](../README.md#installation) for live reload and updates.
