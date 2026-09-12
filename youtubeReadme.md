# YouTube Notes (`youtubenotes.js`)

A tool for using YouTube deliberately instead of falling into it. Four things,
each solving the hole the previous one left:

| | |
|---|---|
| **Notes** | write a note on any video or Short; it shows over that video's thumbnail everywhere you meet it again |
| **Watched marks** | a giant `❌` over anything you have already seen, and the player blocked until you confirm you meant it |
| **History sync** | "watched" means watched *anywhere* — phone, TV, another browser, another account |
| **Gist sync** | one watched list shared across all of your machines |
| **Reflection** | short videos cost you one question: what was that, and why did you watch it |

---

## Notes and watched marks

Write a note in the box above the title on a watch page, or above the channel
name on a Short. It saves as you type, and from then on it is painted over that
video's thumbnail in every feed, search result, sidebar and shelf.

Anything you have watched gets a `❌` over its thumbnail. Open it again and the
player is covered and paused until you click through a confirmation — the point
is to make re-watching a decision rather than a reflex.

Everything lives in `localStorage` under `ytPersonalNotes_v1`, keyed by video id.

---

## Watch-history sync

Marking videos watched only in `localStorage` has an obvious hole: watch
something on your phone, come back to the laptop, and the script has no idea.
So it reads the list YouTube already keeps for you — the one behind
[youtube.com/feed/history](https://www.youtube.com/feed/history).

It does **not** open a tab or scrape a rendered page. It calls the same private
endpoint the YouTube app itself calls, in the background, from a page already
signed in as you:

```
POST /youtubei/v1/browse   { "browseId": "FEhistory" }
```

The reply is paginated with continuation tokens, so the first run walks back
through thousands of entries to build a baseline; after that it only reads far
enough to reach videos it already knows about. Every video id that comes back is
flagged watched.

| | |
|---|---|
| **Any device** | history is server-side, so phone / TV / other browsers all land here |
| **Any account** | every signed-in Google account in the profile is synced, not just the active one (it probes `authuser=0..3` and remembers which ones answered) |
| **Shorts** | picked up as well as normal videos |
| **When it runs** | on page load, when you open a video, when the tab regains focus, and every 15 min — all rate-limited, and it backs off to 15 min after a failure |
| **The video you just opened** | YouTube pushes it to the top of your history within seconds. That one entry is never counted as "you watched this before" — unless its resume bar is already past 10%, which means the progress was made on another device |
| **Offline / signed out / history paused** | fails open: the video plays, nothing gets blocked |

Everything stays local. The only host contacted is `youtube.com`, with the
session you are already logged into.

Knobs in `HISTORY_SYNC` at the top of the file:

- `minWatchPercent` — set to e.g. `15` so videos you bailed out of after a few
  seconds do not count as watched.
- `syncAllAccounts` — off to sync only the account you are signed in as.
- `firstPageGateMs` — how long a freshly opened video waits for the history
  check before it is allowed to play.
- `suppressHoverPreview` — stop YouTube's hover preview from playing a watched
  video behind the `❌`.
- `enabled: false` — turn it all off, keep the notes.

---

## Gist sync (one watched list on every machine)

History sync answers "what did I watch on my phone". This answers "what did I
watch on my *other laptop*" — including videos watched before the script existed
on that machine, or under an account this browser is not signed into.

There is a small `⇅` button floating on every YouTube page. **Drag it anywhere**
— it remembers where you put it, and it follows a video into fullscreen instead
of being stranded behind the player. Click it, paste a GitHub token with the
**`gist`** scope, and that is the whole setup. It will:

1. look through your gists for one it already made, and **adopt it** if found;
2. **create** a secret one if not;
3. pull everything down, merge with what this device knows, push the union back.

Setting up a second, third, fourth device is: paste the same token.

Two files, ids only — no titles, no notes, no timestamps:

```
videos.gist     shorts.gist
------------    ------------
dQw4w9WgXcQ     aBc1DeFgHi2
kJQP7kiw5Fk     ...
```

About 12 bytes per entry, so ten thousand watched videos is ~120 KB.

**Merging is a union, never a replace.** That is what makes it safe on several
machines at once — two devices pushing different new ids cannot clobber each
other, and there is no conflict to resolve. The price: removing a watched mark
locally does not remove it from the shared list. The panel's *"Overwrite gist
with this device's list"* is the deliberate escape hatch, and it asks first.

### Staying synced when the laptop lid comes down

A push cannot be guaranteed to finish — so instead the script guarantees it is
never *lost*:

- the moment this device learns a new id, a **pending flag** is written to
  storage, and only a successful push clears it;
- the push itself fires **10 seconds** later (batched, so a Shorts binge is one
  request, not thirty);
- anything that smells like the session ending — **tab hidden, window blurred,
  `pagehide`, Chrome's `freeze`** — stops waiting and pushes immediately, while
  the page is still alive enough to make the request;
- and if none of that worked, the **next page load sees the pending flag and
  pushes straight away**, before anything else.

Plus the ordinary background pull every 10 minutes, and on tab focus.

```js
YTNotes.gist.open()        // open the panel
YTNotes.gist.connect(tok)  // connect without the UI
YTNotes.gist.sync()        // pull + merge + push now
YTNotes.gist.status()      // account, gist id, counts, last sync, last error
YTNotes.gist.overwrite()   // make the gist match this device exactly
YTNotes.gist.disconnect()  // forget the token on this machine
```

Under Tampermonkey, keep `@grant GM_xmlhttpRequest` and `@connect
api.github.com` in your stub (`template.js` has them) — that path sidesteps CORS
entirely and keeps working if YouTube ever tightens its policy. It is not
strictly required though: youtube.com declares only `script-src`, `object-src`
and `report-uri`, with no `connect-src` and no `default-src` to inherit from, and
api.github.com answers with `access-control-allow-origin: *`, so a plain
`fetch()` to GitHub from a YouTube page works. That is exactly why the
bookmarklet below can sync too.

Also keep `GM_setValue`/`GM_getValue`: that is where the token is stored, in
Tampermonkey's own storage rather than `localStorage` where any script on
youtube.com could read it. The token is only ever sent to `api.github.com`.

---

## Reflection — the speed bump on short videos

Short videos are where the mindless scrolling happens. So anything **under ten
minutes**, and **every Short**, costs one question when you leave it:

```
        What was that?
   [ Entertainment ]  [ Timewaste ]  [ Don't know ]

        Why did you watch it?
   [ Stress ]  [ Work ]  [ Overwhelmed ]  [ Entertainment ]
```

Three design rules, all load-bearing:

1. **Three seconds, then two taps.** The chips are dead for three seconds — long
   enough to interrupt the autopilot, short enough that you never want to open an
   incognito window to escape it. Then it is two one-tap answers and you are gone.
2. **Nothing lands in the same place twice.** Option order, card position and
   chip offsets are all re-rolled on every prompt, and again between the two
   questions — because a fixed layout becomes muscle memory within a day, and
   muscle memory is exactly what this is interrupting.
3. **Skipping costs more than answering.** "not now" only appears after six
   seconds. The fast path is the honest one.

It asks about **anything you held for three seconds or more** — because fast
scrolling is the thing being interrupted, a higher bar than that quietly turns
the whole feature off. A one-second mis-click is ignored; so is long-form video,
and anything you have already answered for. A video whose length cannot be read
is asked about anyway: staying silent whenever the duration was unavailable is
the other way this ends up never firing.

Playback pauses while it asks, and the card follows a video into fullscreen
instead of rendering behind it. The question is written to storage the moment the
video ends, so closing the laptop mid-scroll postpones it to your next session
rather than dodging it.

Your verdict then comes back to you: a video you called `TIMEWASTE · STRESS`
carries that label under its `❌` on every thumbnail from then on.

```js
YTNotes.reflection.summary()  // counts by what and why
YTNotes.reflection.askNow()   // log the current video without waiting to leave it
YTNotes.reflection.pending()  // questions still queued
YTNotes.reflection.debug()    // why the last video was or was not asked about
```

`debug()` is there because a prompt that never fires looks identical to a prompt
that is switched off. It reports what is being watched, how long it has been
held, the duration it managed to read, the current thresholds, and a plain
sentence for the last decision — `"skipped: only 1.4s, under minWatchSeconds
(3)"`. Every decision is also logged to the console as it happens.

Knobs in `REFLECTION`: `maxDurationSeconds` (600), `includeShorts`,
`minWatchSeconds` (3), `pauseSeconds` (3), `skipAfterSeconds` (6),
`randomisePlacement`, and the two option lists — `whatOptions` and `whyOptions`
are just arrays, so put your own categories in them.

---

---

## On your phone, without Tampermonkey

Mobile Chrome has no extensions, but it does have bookmarks — and a bookmark
whose URL starts with `javascript:` runs against whatever page you are looking
at. [`bookmarklet.html`](bookmarklet.html) packs this whole script into one of
those.

**Build it** (once, on a desktop):

1. Open `bookmarklet.html`, pick `youtubenotes.js`, and **leave "minify"
   ticked** — unminified this script is a ~207 KB URL, past the point where
   browsers start refusing to store bookmarks. Copy the `javascript:` URL.
2. Make a new bookmark in desktop Chrome, paste that as the URL, and name it
   something short and typeable — `yt`.
3. Let Chrome sync bookmarks to your phone (same Google account, sync on).

If the bookmark does not show up on the phone, sync has likely dropped it for
length. You can put it there by hand: bookmark any ordinary page on the phone,
then **edit** that bookmark and paste the `javascript:` URL over its address —
Android Chrome will not let you *type* a `javascript:` URL into the omnibox, but
it will happily keep one you paste into an existing bookmark.

**Use it** (each time you open YouTube):

1. Open YouTube on the phone and wait for the page to load.
2. Tap the address bar and type the bookmark's name — `yt`.
3. Tap the **bookmark** entry in the dropdown, not a search result.

The script starts on the page you are already on. YouTube is a single-page app,
so it keeps working as you browse from there — you only tap it again after a
genuine page reload. On iOS the same trick works in Safari: bookmark, then type
its name in the address bar and tap the result.

**What works, and what does not:**

| | |
|---|---|
| Watched crosses, player block, history sync, reflection prompts, the `⇅` button | yes — these key off links, URLs and YouTube's own API, not page markup |
| **Gist sync** | **yes.** The builder shims `GM_xmlhttpRequest` onto `fetch`, and as explained above nothing on youtube.com blocks that from reaching GitHub |
| The note textareas | probably not on `m.youtube.com` — they attach to desktop renderers like `ytd-watch-metadata`. Use Chrome's **"Request desktop site"** and they come back |
| Running it twice on one page | you get an alert saying it is already running, not a second copy |

Two things worth knowing:

- **`m.youtube.com` and `www.youtube.com` are different origins**, so they keep
  separate `localStorage`. Watched marks made on the mobile site are invisible to
  the desktop site on the same phone. Gist sync is what stitches them together —
  it is the shared source of truth, so connect the same token everywhere and they
  converge.
- In bookmarklet mode there is no Tampermonkey storage, so **the token lives in
  `localStorage` on youtube.com**, where any script on that origin could read it.
  The panel says so plainly when it is running that way. Give the token nothing
  but the `gist` scope, and revoke it from GitHub if the phone goes missing.

## Everything else

```js
YTNotes.syncNow()      // incremental history sync
YTNotes.fullResync()   // deep re-walk of the whole history
YTNotes.stats()        // watched / notes / synced counts, last sync, accounts
YTNotes.clearSynced()  // drop watched marks that came from sync (notes kept)
YTNotes.config         // live knobs: .history, .gist, .reflection
```

All of it is also on the Tampermonkey menu for the script.

## Install

See the [Tampermonkey setup guide in the main README](README.md#installation).
Point the stub's `@require` at your local copy of `youtubenotes.js`, and keep the
`GM_xmlhttpRequest` / `@connect api.github.com` lines if you want gist sync.
