# Daily Scripts ;-D

These are some utilities I found myself needing and found useful, so I created them. 
Why scripts: Because i found mostly myself in browser or in terminal. That's all where i live most of my time. 


## Scripts Included

### 1. AiUtils (`AiUtil.js`) — [full docs: AIUtil.md](AIUtil.md)
A dock for ChatGPT, Claude, Copilot, Gemini and Grok. Keeps a Gist-synced
library of your prompts (with a quick dock over the chat input box so a prompt
is one click away), exports conversations to Markdown or JSON, and squeezes text
down with a minifier, a JSON→TOON converter and Snapcompact. Can also be packed
into a bookmarklet for mobile — see [`bookmarklet.html`](bookmarklet.html).

### 2. YouTube Notes (`youtubenotes.js`) — [full docs: youtubeReadme.md](youtubeReadme.md)
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

### 3. WhatsApp Rotate (`whatsappRotate.js`)
WhatsApp Web's image viewer has no rotate button. This adds rotate left / right
buttons to the viewer's top toolbar, plus `R` / `Shift+R` shortcuts. A photo
taken sideways is scaled up to fill the viewer once it's turned, and each photo
keeps its rotation while you page through the album. Zoom still works on a
rotated photo. The file has its own `==UserScript==` header, so you can paste it
straight into Tampermonkey or load it through the `template.js` stub.

### 4. tinkatuff (`tinkatuff.js`)
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

- **Report** — the summary, then every finding by area: TLS, certificate,
  network traffic, WebCrypto calls, stored keys, tokens, passkeys, libraries,
  scripts/WASM, published keys, console, DNS/email.
- **Inventory** — every algorithm seen, quantum-safe or not, its replacement
  (ML-KEM / ML-DSA / X25519MLKEM768) and its NIST IR 8547 deadline.
- **Network** — each fetch / XHR / WebSocket / beacon with what was in it:
  Bearer and DPoP tokens, HTTP signatures, keys in responses, and request fields
  RSA-encrypted in the browser (a password sent as a 256-byte blob).
- **Console** — crypto errors, logged CryptoKeys, and keys or tokens printed to
  the console (redacted).
- **Settings** — theme, logo, button position, what to watch, Radar token.
  The Radar token is optional: free Cloudflare account → My Profile → API Tokens
  → Create Custom Token → *User · User Details · Read*.

Next to the quantum checks it also covers general web-security basics, in the
same plain language: HSTS, CSP, plain-HTTP redirects, login cookies (HttpOnly,
Secure, SameSite, lifetime), third-party files without SRI, passwords / refresh
tokens / API secrets left in browser storage, certificate expiry, CAA, DMARC,
MTA-STS, Encrypted Client Hello and legacy ciphers (3DES, RC4, SHA-1). Want to
see everything at once? [`tinkatuff-demo/`](tinkatuff-demo/) is a local page
with every flaw planted on purpose (`python3 -m http.server 8765` inside it).

It hooks WebCrypto, WebAuthn, fetch, XHR, WebSocket, WebAssembly, workers, Web
Push, WebRTC, console and postMessage at `document-start`, so it reports what
the page *does*, not only what its code mentions. **Deep scan** (on demand)
adds the edge/CDN of every origin (plus a real PQ-TLS handshake test through
Cloudflare Radar with a token), the certificate from CT logs, DNSSEC and DKIM,
every JS file, worker and WASM binary the page loaded and their source maps
(→ exact crypto npm packages), OpenID/JWKS keys, the `security.txt` PGP key,
`did.json`, and CryptoKeys stored in IndexedDB. Exports JSON, Markdown, a
CycloneDX 1.6 CBOM and SARIF. Its header needs `@run-at document-start`, so
paste it straight into Tampermonkey (or give the `template.js` stub the same
`@run-at`, `@grant`s and `@connect`s). Console capture makes DevTools show the
script as the source of every log line; switch it off from the menu while
debugging.

### 5. monk (`monk.js`)
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

It works by adding a Content-Security-Policy `<meta>` at `document-start`, so
the browser itself refuses the blocked downloads. It can only make a site
stricter, never looser; a few files the browser starts fetching before any
script can run (the first preloads in `<head>`) may still come through. If
Tampermonkey starts it late, Static strips the page CSS by hand and the panel
shows a warning; Tampermonkey's *Inject Mode: Instant* setting (Advanced
config) avoids that where it's offered. Its
header needs `@run-at document-start` and `@connect *` (for click-to-load
images), so paste it straight into Tampermonkey or give the `template.js` stub
the same lines.

## Installation

These scripts run using the [Tampermonkey](https://www.tampermonkey.net/) browser extension. Because these scripts load their code locally from your computer (using `@require`), you need to configure Tampermonkey to allow local file access.

### Tampermonkey Setup Guide

1. **Install Tampermonkey:** Get the extension for your browser.
2. **Allow File URL Access (Crucial for Chrome/Edge):**
   - Go to your browser's Extension Settings (e.g., `chrome://extensions/`).
   - Find **Tampermonkey** and click **Details**.
   - Turn ON **Allow access to file URLs**.
3. **Enable Advanced Settings in Tampermonkey:**
   - Click the Tampermonkey extension icon and open the **Dashboard**.
   - Go to the **Settings** tab.
   - Under the **General** section, change **Config mode** to **Advanced**.
   - Scroll down to the **Security** section.
   - Find **Allow scripts to access local files** (or similar) and set it to **Always** (or allow it when prompted).
4. **Add the Scripts:**
   - Click the Tampermonkey icon → **Create a new script...**
   - Use the code in `template.js` as your boilerplate.
   - Update the `@require` path in the template to point to the absolute path of `AiUtil.js` or `youtubenotes.js` on your local machine (e.g., `file:///path/to/repo/youtubenotes.js`).
   - Save the script (`Ctrl + S` or `Cmd + S`).

- Made by: me and other engineers (whose projects I used or part of code I used)
- AI used: Gemini, Claude
- Tool used: Vim
- AI tool: agy

## License
MIT License
