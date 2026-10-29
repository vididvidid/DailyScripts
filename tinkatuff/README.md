# tinkatuff (`tinkatuff.js`)

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
see everything at once? [`demo/`](demo/) is a local page
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
paste it straight into Tampermonkey (or give the [`template.js`](../template.js) stub the same
`@run-at`, `@grant`s and `@connect`s). Console capture makes DevTools show the
script as the source of every log line; switch it off from the menu while
debugging.

## Install

The file carries its own `==UserScript==` header, so it installs as it is: in
[Moss](https://github.com/vididvidid/Moss) use **Import…** with this file's GitHub link
(or **+ Script** and paste it); in Tampermonkey paste it into a new script. See the
[installation guide](../README.md#installation) for live reload and updates.
