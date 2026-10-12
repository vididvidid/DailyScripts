# tinkatuff demo

A local page with every kind of flaw tinkatuff looks for planted on purpose, so
you can see the full report without pointing it at anyone else's site.

```bash
cd tinkatuff-demo
python3 -m http.server 8765
```

Open <http://localhost:8765/> with tinkatuff installed in Tampermonkey, wait for
"done — open tinkatuff" in the page log, then click the tinkatuff button. Press
**Deep scan** to add the worker, source map, JWKS, `security.txt`, `did.json`
and IndexedDB findings. The first deep scan may make Tampermonkey ask whether the
script may connect to `localhost`; allow it.

The page lists what is planted, so you can compare it with the report.

- Everything secret-looking (the private key, tokens, the encrypted password) is
  generated in your browser on each load. Nothing in this folder is a real secret.
  `pgp-key.txt` is a throwaway *public* key.
- The page needs internet once, to load JSEncrypt from unpkg. Offline, it sends
  random 256 bytes in place of the encrypted password, which is still caught.
- DNS, email (DKIM, DMARC, MTA-STS), certificate and HSTS checks need a real
  HTTPS domain, so on `localhost` they come back empty or "lookup failed".
- `POST /login` gets a 501 from Python's server. That's expected; the request
  body is what tinkatuff inspects.
- The `security.txt` key URL is `http://localhost:8765/…`; if you serve on another
  port, change it there.
