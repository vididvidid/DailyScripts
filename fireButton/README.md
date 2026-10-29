# Fire button (`fireButton.js`)

DuckDuckGo's Fire button for any Chromium browser. Two commands in the toolbar
popup: **🔥 Burn this tab** closes the tab you're on and wipes that site's
cookies, storage, cache and history entries; **🔥 Burn all** closes every tab
and wipes all browsing data (history, downloads list, cookies, cache, site
storage, form data), leaving one fresh tab. Needs **Moss** rather than
Tampermonkey: it's a background script that uses the browser's own
`browsingData`, `history` and `tabs` APIs, which Tampermonkey scripts can't reach.
Paste the file into Moss (**+ Script**) and accept the permissions it asks for.

## Install

The file carries its own `==UserScript==` header, so it installs as it is: in
[Moss](https://github.com/vididvidid/Moss) use **Import…** with this file's GitHub link
(or **+ Script** and paste it); in Tampermonkey paste it into a new script. See the
[installation guide](../README.md#installation) for live reload and updates.
