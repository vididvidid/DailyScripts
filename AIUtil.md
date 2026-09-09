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

## The dock

The dock is the vertical icon rail that floats over the page. Drag it by the
`::` handle; click the round eye at the bottom to collapse it to a single dot.
Its position and collapsed state are remembered.

| Icon | Tool | Shortcut |
| --- | --- | --- |
| `PL` | Prompt Library | `ALT+P` |
| `MD` | Export chat to Markdown | `ALT+M` |
| `JD` | Export chat to JSON | `ALT+J` |
| `URL` | Output filename format | |
| `JT` | JSON → TOON converter | |
| `TM` | Text Minifier | |
| `IC` | Snapcompact (chat → dense PNG) | |
| `QB` | Show/hide the Quick Bar | `ALT+Q` |
| `^` | Auto-scroll (Gemini only) | `ALT+A` |

## Prompt Library

A place to keep the prompts you retype constantly.

- **`+ New prompt`** opens a title box and a body box. Paste the prompt, name
  it, save it.
- **Clicking a saved prompt inserts it straight into the site's chat input
  box**, at the caret. If the input box cannot be found, the prompt is copied
  to your clipboard instead so the click is never wasted.
- Each row also has copy (`⧉`), edit (`✎`) and delete (`✕`).
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

Sync is a three-step pull → merge → push, not an overwrite, so two machines
editing different prompts will not clobber each other. Merging is per prompt,
last-write-wins on the prompt's own `updatedAt`. Deleting a prompt leaves a
tombstone behind rather than removing the record, otherwise a sync from a
machine that had not seen the delete would resurrect it.

The gist holds one file, `aiutil-prompts.json`:

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

## Quick Bar

A thin strip of prompt chips that docks itself just above the chat input box,
wherever that box happens to be. Click a chip to insert that prompt. It sits at
55% opacity until you hover it, so it stays out of the way.

- `+` — save a new prompt (opens the library's form)
- `☰` — open the full Prompt Library
- `✕` — hide the bar (`ALT+Q` brings it back)

The bar is a `position: fixed` element rather than something injected into the
composer, because every one of these sites re-renders its composer subtree
constantly and would wipe an injected child. It re-measures the composer on
resize, on scroll, and on a slow poll, so it follows the box as it grows while
you type, and it flips to sitting *below* the composer if there is no room
above. On narrow layouts it drops its hint text and the chips scroll
horizontally.

> This is an early feature — the point right now is to find out whether having
> prompts one click from the input box is actually useful before more is built
> on top of it.

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

- **Current chat — checked items** — the turns ticked in the export list
- **Current chat — entire conversation** — everything
- **Custom pasted text** — whatever you type or load

**Text Minifier** collapses runs of whitespace to single spaces and reports how
many characters that saved.

**JSON → TOON** converts JSON to the more token-efficient TOON format. With a
chat source it converts the conversation itself (as
`{ title, platform, exportedAt, messages[] }`); with the custom source it
converts pasted JSON or a loaded `.json` file.

**Snapcompact** renders the source into dense monospace PNG "pages" with a
rough token estimate, for when pasting an image is cheaper than pasting text.
If it all fits on one page you also get *Copy Image & Open New Chat*.

## Auto-scroll (Gemini)

Gemini lazy-loads history upward, so an export would otherwise only capture
what has been scrolled into view. When auto-scroll is on the script walks the
conversation to the top first. Toggle it with `^` on the rail or `ALT+A`.

## Notes

- The dock stays visible on a brand-new empty chat — that is exactly when the
  Prompt Library and Quick Bar are most useful. The export sections simply
  report that there is nothing to export yet.
- Keyboard shortcuts are ignored while you are typing in an input, textarea or
  contenteditable.

## Credits

Built on top of [RevivalStack's ChatGPT
exporter](https://github.com/revivalstack/chatgpt-exporter); the two-column
icon-dock UI refactor is by Mic Mejia.
