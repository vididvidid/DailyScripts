# Daily Scripts ;-D

These are some utilities I found myself needing and found useful, so I created them. 


## Scripts Included

### 1. AiUtils (`AiUtil.js`)
A compilation of various tools and scripts found over the internet to help you use AI more efficiently. It includes tools for downloading chat conversations, minifying JSON/text content for efficient storage and processing, and more.

### 2. YouTube Notes (`youtubenotes.js`)
A tool designed to help limit your YouTube usage or use it more wisely. It allows you to:
- Write and save markdown notes directly on YouTube videos and Shorts.
- Automatically mark videos as "watched".
- Overlay a giant `❌` on watched videos in your feeds to remind you that you've already seen them and don't need to waste time re-watching them (unless you explicitly choose to).

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
