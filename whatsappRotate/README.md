# WhatsApp Rotate (`whatsappRotate.js`)

WhatsApp Web's image viewer has no rotate button. This adds rotate left / right
buttons to the viewer's top toolbar, plus `R` / `Shift+R` shortcuts. A photo
taken sideways is scaled up to fill the viewer once it's turned, and each photo
keeps its rotation while you page through the album. Zoom still works on a
rotated photo. The file has its own `==UserScript==` header, so you can paste it
straight into Tampermonkey or load it through the [`template.js`](../template.js) stub.

## Install

The file carries its own `==UserScript==` header, so it installs as it is: in
[Moss](https://github.com/vididvidid/Moss) use **Import…** with this file's GitHub link
(or **+ Script** and paste it); in Tampermonkey paste it into a new script. See the
[installation guide](../README.md#installation) for live reload and updates.
