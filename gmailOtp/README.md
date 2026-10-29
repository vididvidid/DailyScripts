# Gmail OTP autofill (`gmailOtp.js`)

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

The code is filled automatically only when the mail came from the site's own
domain; from anyone else it shows the code with a warning and **Fill / Copy**
buttons, so a look-alike phishing page never gets your real code without a
click. A code is never handed out twice, mail older than the OTP box doesn't
count, and a Gmail conversation is opened so only its newest mail is read.
Split boxes are filled by pasting, then by typing digit by digit, and read
back — "Filled" means the boxes really hold the code. If the page clears them
(wrong code, resend), it offers to fetch the new one. It never submits the form. The Tampermonkey menu turns auto-fetch and
auto-fill off, or picks another signed-in Gmail account (`u/1`, …).

## Install

The file carries its own `==UserScript==` header, so it installs as it is: in
[Moss](https://github.com/vididvidid/Moss) use **Import…** with this file's GitHub link
(or **+ Script** and paste it); in Tampermonkey paste it into a new script. See the
[installation guide](../README.md#installation) for live reload and updates.
