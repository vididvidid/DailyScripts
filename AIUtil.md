# AiUtils (`AiUtil.js`)

A single Tampermonkey userscript that adds a small draggable dock to ChatGPT,
Claude, Copilot, Gemini and Grok. From that dock you can export the
conversation, keep a synced library of your prompts, and squeeze text down
before pasting it back into a chat.

Everything runs locally in the browser. The only network call the script ever
makes is to `api.github.com`, and only if you turn on Gist sync.

## Supported sites

| Site | Hosts |
| --- | --- |
| ChatGPT | `chat.openai.com`, `chatgpt.com` |
| Claude | `claude.ai` |
| Copilot | `www.copilot.com` |
| Gemini | `gemini.google.com` |
| Grok | `grok.com` |

## Two docks

There are two pieces of UI, and the rest of this file uses these names:

- **Floating Dock** — the vertical icon rail with the full menu. Drag it by the
  dotted grip at the top; click the eye at the bottom to collapse it to a
  single dot.
- **Quick Dock** — the thin strip over the chat input box: prompt chips, the
  context light, and one-click tools that rewrite what you have typed.

The Floating Dock remembers where you put it as a *fraction of the viewport*,
not as pixel coordinates, so it holds the same relative spot when the window
resizes or you cycle through device sizes in responsive mode. Parked on the
right edge, it stays on the right edge at every width.

Hover an icon for a card with its name, what it does and its shortcut. Both
docks use the
Inter typeface; it is fetched once from jsDelivr and registered from its bytes,
so a site's font policy cannot block it (without it they fall back to the
system font).

The rail is two columns wide, with related tools side by side. Rail icons,
left to right, top to bottom:

| Icon | Tool | Shortcut |
| --- | --- | --- |
| open book | Prompt Library | `ALT+P` |
| sparkle | Skills Library | `ALT+K` |
| page with lines | Export chat to Markdown | `ALT+M` |
| page with braces | Export chat to JSON | `ALT+J` |
| `{ }` | JSON → TOON converter | |
| inward arrows | Text Minifier | |
| picture | Snapcompact (chat → dense PNG) | |
| sliders | Output filename format | |
| lightning bolt | Show/hide the Quick Dock (dimmed when off) | `ALT+Q` |
| gauge | Context meter (the dot in its corner is the current colour) — *experimental* | |
| speech bubble with arrow | New chat with context — *experimental* | |
| arrow to top | Auto-scroll (Gemini only; dimmed when off) | `ALT+A` |

## Skills Library

Like the Prompt Library, but for *skills*: reusable instruction sets you want
the model to follow — a code-review checklist, a writing style, a PDF workflow.

- **+ New skill** — a name, an optional "use when" line, and the instructions.
- **Import .md** — add one or more `SKILL.md`-style files. YAML front matter
  `name:` and `description:` are read; everything after it is the instructions.
  Without front matter the filename becomes the name.
- **Click a skill** to bring it into the chat. *On click* picks how:
  - *Type it into the input box* (default) — inserted as
    `<skill name="…">Use when: …\n…instructions…</skill>`, so you can add your
    message under it.
  - *Attach it as a .md file* — attached as `<name>.md` in `SKILL.md` layout.
    If the site will not take the file, it falls back to typing it in.
- Copy (as `SKILL.md`), edit and delete per skill; filter by name, description
  or text.

Skills are stored alongside your prompts and sync through the same gist
(**Sync gist** in either library). They also show on the Quick Dock as dashed
chips with a sparkle, after your prompts.

## Prompt Library

A place to keep the prompts you retype constantly.

- **`+ New prompt`** opens a title box and a body box. Paste the prompt, name
  it, save it.
- **Clicking a saved prompt inserts it straight into the site's chat input
  box**, at the caret. If the input box cannot be found, the prompt is copied
  to your clipboard instead so the click is never wasted.
- Each row also has copy, edit (pencil) and delete (bin).
- The filter box searches both titles and bodies.

Prompts are stored by Tampermonkey (`GM_setValue`), so they survive restarts
and are private to your browser.

### Gist sync

To carry the same library between browsers and machines, mirror it to one
**secret** GitHub Gist.

1. Create a GitHub token with gist access:
   - fine-grained token → **Account permissions → Gists → Read and write**, or
   - classic token → the **`gist`** scope.
2. Open the Prompt Library → **Gist settings**, paste the token, press
   **Save**.
3. Press **Create gist**. This makes a new secret gist and fills in its id.
   (Already have one? Paste its id into the *Gist id* field instead and press
   **Save**.)
4. Press **Sync gist** whenever you want to push and pull.
5. Press **View on GitHub** to open the gist on gist.github.com in a new tab.

Sync is a three-step pull → merge → push, not an overwrite, so two machines
editing different prompts will not clobber each other. Merging is per prompt,
last-write-wins on the prompt's own `updatedAt`. Deleting a prompt leaves a
tombstone behind rather than removing the record, otherwise a sync from a
machine that had not seen the delete would resurrect it.

The gist holds one file, `prompts.gist`, whose content is JSON. (Gists made
before the rename used `aiutil-prompts.json`; that file is still read, and is
removed on the next sync once its prompts are in `prompts.gist`.)

```json
{
  "version": 1,
  "updatedAt": "2026-09-09T10:00:00.000Z",
  "prompts": [
    { "id": "p-…", "title": "…", "body": "…", "createdAt": "…", "updatedAt": "…" }
  ]
}
```

The token is stored locally by Tampermonkey and is only ever sent to
`api.github.com`. Because these AI sites ship a strict CSP that blocks a normal
`fetch()` to GitHub, sync goes through `GM_xmlhttpRequest` — which is why your
stub needs `@grant GM_xmlhttpRequest` and `@connect api.github.com`. Without
them the script will tell you so rather than failing quietly.

## Quick Dock

A thin strip that docks itself just above the chat input box, wherever that box
happens to be. It sits at 55% opacity until you hover it, so it stays out of the
way.

Left to right:

- **Prompt chips** — click one to insert that prompt at the caret.
- **Context light** — green, yellow or red; see [Context meter](#context-meter).
  Click it for the details.
- **`{ }` JSON → TOON** — converts the JSON in the input box to TOON and puts
  the result back. It takes, in order: the whole box if it is one JSON
  document; otherwise every ```` ```json ```` fenced block (the prose around
  them is left alone); otherwise everything from the first line that starts
  with `{` or `[` to the end.
- **Inward arrows — Minify** — collapses all whitespace in the box to single
  spaces.
- **Picture — Snapcompact** — renders the box's text into dense PNG pages,
  attaches them to the message and empties the box. The first page is also put
  on the clipboard; if the site ignores the attach, the text stays and the toast
  tells you to press Ctrl+V.
- **Bookmark — Save as prompt** — asks for a title and saves the box's text to
  the Prompt Library. With an empty box it opens the new-prompt form instead.
- **Arrow bubble — New chat with context** — opens a new chat with this whole
  conversation already in its input box, in the format picked in the Floating
  Dock. See [New chat with context](#new-chat-with-context).
- **Book** — open the full Prompt Library.
- **Sparkle** — open the Skills Library.
- **`✕`** — hide the dock (`ALT+Q` brings it back).

Every tool replaces the whole input box and shows a short note above the dock
with the before/after token estimate. The replacement goes through the editor's
own input path, so **Ctrl+Z in the input box undoes it**.

The Quick Dock is a `position: fixed` element rather than something injected into the
composer, because every one of these sites re-renders its composer subtree
constantly and would wipe an injected child. It re-measures the composer on
resize, on scroll, and on a slow poll, so it follows the box as it grows while
you type, and it flips to sitting *below* the composer if there is no room
above. On narrow layouts it drops its hint text and the chips scroll
horizontally.

## Context meter

Long chats get slower, forget earlier details and answer worse, well before
they hit the model's hard limit. The meter tells you when to move on:

| Light | Means |
| --- | --- |
| Green | Continue the chat. |
| Yellow | Get ready: finish the current thread of work, a switch is coming. |
| Red | Switch now. |

Yellow starts at 50% of the site's token budget and red at 80%.

### It counts the whole chat, not just the screen

These sites only render part of a long conversation (Gemini lazy-loads older
turns), so counting the page would make an old chat look short. The meter asks
the site's own backend for the full thread, the same way the site loads it,
using the session you are already signed in with:

| Site | Endpoint |
| --- | --- |
| ChatGPT | `/backend-api/conversation/{id}` (token from `/api/auth/session`) |
| Claude | `/api/organizations/{org}/chat_conversations/{id}?tree=True` |
| Gemini | `batchexecute`, rpc `hNvQHb` |
| Grok | `/rest/app-chat/conversations/{id}/response-node` + `load-responses` |
| Copilot | page only |

It counts only the branch you are on (edited or regenerated turns elsewhere in
the tree are skipped), and adds the context the page hides: custom
instructions, memory, tool calls and results, and the text of attached files.
Reasoning/thinking is left out, because it is not carried into later turns.
If the history cannot be read, the meter falls back to the page and says why.

The history is refetched a few seconds after the page goes quiet, and at most
every 15 seconds while a reply streams. **Recount now** forces it.

### It uses the real tokenizer

None of these sites tells its own page how many tokens a chat uses (claude.ai
strips it from its stream), so the count is made here, with the most exact
method that exists for each site:

| Site | Tokenizer | Exact? |
| --- | --- | --- |
| ChatGPT, Copilot | OpenAI's `o200k_base` (GPT-4o / 4.1 / 5, o-series), run locally | Yes, token for token |
| Claude | Anthropic `POST /v1/messages/count_tokens` | Yes, with an API key |
| Gemini | Google `models/{model}:countTokens` | Yes, with an API key |
| Grok | xAI `POST /v1/tokenize-text` | Yes, with an API key |

- **o200k_base** is fetched once from jsDelivr (js-tiktoken's copy of OpenAI's
  file, 2.3 MB) and cached. The encoder is a port of tiktoken's merge, checked
  against js-tiktoken on code, prose, CJK, emoji and very long runs.
- **Claude, Gemini and Grok** have no public local tokenizer for their current
  models (OpenAI's undercounts Claude by 15–20%). Their counting endpoints are
  free but need your own key: put it in the meter panel under the budget, and
  optionally the model (Claude defaults to the chat's own model). The key stays
  in Tampermonkey storage; the chat text goes only to that provider's API, and
  only when it has changed.
- Without a key, those sites show an estimate (about 4 characters per token)
  and every number is marked `~`.
- With an API count, the total is exact; the split between you, the AI and
  context is shared out from it and marked `~`.

Images, PDFs and the site's own hidden system prompt cannot be counted from
the page, so the real total is somewhat higher. The panel shows how many
images/files were skipped.

### Plan usage (claude.ai)

On claude.ai the panel also shows the site's own quota numbers (5-hour session
and weekly usage, with reset times) from `/api/organizations/{org}/usage`.
That is your plan limit, not the chat's context, so it does not change the
light.

### Default budgets

| Site | Default budget |
| --- | --- |
| ChatGPT | 100k |
| Claude | 150k |
| Copilot | 60k |
| Gemini | 400k |
| Grok | 100k |

The budgets are rough guesses, not the models' real context windows. Tune them
to the model you actually use.

### The detailed view

The gauge icon on the Floating Dock opens it. It shows:

- a bar with the yellow and red marks on it
- where the count came from (full history or page) and which tokenizer was used
- your messages, the AI replies, hidden context, the largest single item, the
  average per turn, and roughly how many turns are left before red
- **Ask for handoff summary**, which puts a "summarize this chat so I can
  continue in a new one" prompt in the input box
- **Open new chat** and **Recount now**
- the budget, both thresholds and, on Claude / Gemini / Grok, the API key and
  model, all editable (**Defaults** resets the budget and thresholds)

### Stub permissions

The tokenizer downloads and count APIs go through `GM_xmlhttpRequest`, so the
installed stub needs these alongside `@connect api.github.com`:

```
// @connect      cdn.jsdelivr.net
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.x.ai
```

Without them the meter still works, falling back to the estimate, and the panel
says which request was blocked. The bookmarklet always uses the estimate for
the same reason, but it still reads the full history.

## New chat with context

*Experimental.* When a chat gets long (the meter turns yellow or red), this
starts a fresh one that still knows everything so far. It reads the **whole**
conversation from the site, from the first turn — the same full history the
meter uses — packs it, opens the site's new-chat page and fills the input box.
Nothing is sent; you add your next message and press send.

Start it from the arrow button on the Quick Dock, the **New chat with context**
button in the context meter, or the section of the same name on the Floating
Dock, which is also where the options live (they save as you change them, and
the Quick Dock button always uses them):

| Format | What the new chat gets |
| --- | --- |
| Transcript | `User: … / Assistant: …` text |
| TOON | The chat as TOON — the fewest tokens for long chats (default) |
| Minified | The transcript with all whitespace collapsed |
| Snapcompact | The chat rendered to dense images, attached to the message |

- **Text of attached files** (on) and **Tool calls and results** (off) choose
  what hidden context goes along. Custom instructions and memory are left out;
  the new chat applies them itself.
- **Open in a new tab** (on) keeps the old chat open. Off, the current tab moves
  to the new chat.
- **Opening message** is the text placed above the conversation. The default
  asks the model to take it in and wait for your next message.

The package crosses the page load through Tampermonkey storage, tagged with an
id in the new page's URL, and expires after three minutes if no page picks it
up. If the full history cannot be read, the visible page is used and the status
line says so. Sites cap how many images one message can carry, so a very long
chat in Snapcompact form may need trimming.

## Export

`MD` and `JD` list every user turn in the conversation with a checkbox. Uncheck
the turns you do not want, then download. An AI reply follows the checked state
of the user turn above it.

Markdown export includes a table of contents and back-to-top links. JSON export
is the structured conversation.

Filenames come from the `URL` section's format string:

`{platform}` `{title}` `{timestamp}` `{timestampLocal}` `{tags}` `{tag1}`…`{tag9}` `{exporter}`

Tags are read out of the chat title: `#work Refactor the parser #urgent` gives
the title `Refactor the parser` and the tags `work`, `urgent`.

## Text Minifier, JSON → TOON, Snapcompact

All three read from the same **Source** picker:

- **Current chat — pick turns** — shows a checklist of every user turn right
  inside the tool; tick the ones you want. Everything starts ticked, `Select
  all` flips them together, and turns that arrive while you are working show up
  pre-ticked. A ticked turn brings its AI replies with it.
- **Current chat — entire conversation** — everything
- **Custom pasted text** — whatever you type or load

Each tool keeps its own checklist, so a selection in the Minifier does not
disturb one in Snapcompact.

**Text Minifier** collapses runs of whitespace to single spaces and reports how
many characters that saved.

**JSON → TOON** converts JSON to the more token-efficient TOON format. With a
chat source it converts the conversation itself (as
`{ title, platform, exportedAt, messages[] }`); with the custom source it
converts pasted JSON or a loaded `.json` file.

**Snapcompact** renders the source into dense monospace PNG "pages" with a
rough token estimate, for when pasting an image is cheaper than pasting text.
Click a page's thumbnail (or **View full size**) to open it full screen at
actual pixel size — what the model receives — to check the text is still
legible; **Fit** shrinks it to the screen, `←`/`→` move between pages, and a
click anywhere or `Esc` closes it.
If it all fits on one page you also get *Copy Image & Open New Chat*.

## Use it on a phone — bookmarklet

Tampermonkey does not exist on most mobile browsers, so AiUtil can also be
packed into a single `javascript:` bookmark.

### ▸ [**Open the bookmarklet builder**](bookmarklet.html)

`bookmarklet.html` sits next to this file in the repo. Open it, load `AiUtil.js`
(button, file picker, or paste), press **Build bookmarklet**, then **Copy**.
Leave *Minify first* ticked — it takes the result from about 300 KB down to
about 130 KB, which matters when your browser has to store it as a bookmark URL.

Because GitHub renders Markdown without scripts, the builder has to be its own
page — open it from a local clone, or from GitHub Pages if you publish the repo.
The **Load from this folder** button only works when the page is served over
`http(s)`; opening it straight off disk blocks the fetch, so use **Choose
file…** there.

### Installing it on the phone

1. Build and copy the bookmarklet (easiest on the phone itself).
2. Bookmark any page, edit that bookmark, replace the URL with what you copied,
   and name it `AiUtil`.
3. **Chrome / Android** — open an AI chat, type `AiUtil` in the address bar and
   choose the bookmark from the suggestions.
   **Safari / iOS** — save it in Favourites and tap it from the bookmarks menu.

### What the bookmarklet gives up

The builder wraps the script in stand-ins for the Tampermonkey API, which
changes a few things:

- It runs once per page load — tap it again after a reload.
- Prompts go to that site's `localStorage` rather than Tampermonkey storage, so
  they are **per-site** and are lost if you clear site data.
- Gist sync will usually fail. Without `GM_xmlhttpRequest` the request falls
  back to `fetch()`, which these sites' CSP blocks. Sync on the desktop; use the
  prompts on mobile.
- Some browsers cap how long a bookmark URL may be. If yours refuses it, install
  [Violentmonkey](https://violentmonkey.github.io/) on Firefox for Android and
  run the normal userscript — that path has none of these limits and is the
  better mobile setup if it is available to you.

## Auto-scroll (Gemini)

Gemini lazy-loads history upward, so an export would otherwise only capture
what has been scrolled into view. When auto-scroll is on the script walks the
conversation to the top first. Toggle it with `^` on the rail or `ALT+A`.

## Notes

- The Floating Dock stays visible on a brand-new empty chat — that is exactly when the
  Prompt Library and Quick Dock are most useful. The export sections simply
  report that there is nothing to export yet.
- Keyboard shortcuts are ignored while you are typing in an input, textarea or
  contenteditable.

## Credits

Built on top of [RevivalStack's ChatGPT
exporter](https://github.com/revivalstack/chatgpt-exporter); the two-column
icon-dock UI refactor is by Mic Mejia.
