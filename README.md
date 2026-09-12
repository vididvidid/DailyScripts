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
