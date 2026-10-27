/*
 * File: tinkatuff.js
 * Author: vididvidid
 * Created: 2026-10-12
 *
 * versions:
 *
 * 0.4.2          the SRI check skips CAPTCHA widgets (reCAPTCHA, hCaptcha,
 *                Cloudflare Turnstile / challenges, Arkose, GeeTest, …) —
 *                they can't carry a fixed hash and must not be self-hosted —
 *                and lists them as an info line instead of a weak spot;
 *                clicking anywhere outside the report closes it
 *
 * 0.4.1          "Copy for AI" button — copies the whole result as a ready
 *                prompt (instructions + every finding, grouped, with where
 *                and suggested fixes + the crypto inventory) to paste into
 *                any AI assistant for a detailed explanation and fix plan;
 *                secrets stay redacted
 *
 * 0.4.0          general web-security checks next to the quantum ones
 *                (they land under "broken today" / "other weak spots"):
 *                HSTS, CSP, plain-HTTP redirect, login cookies (HttpOnly,
 *                Secure, SameSite, lifetime), third-party files without
 *                SRI, passwords / refresh tokens / API secrets in browser
 *                storage, certificate expiry and lifetime, CAA, DMARC,
 *                MTA-STS, TLS-RPT, Encrypted Client Hello, HTTP/3, and
 *                3DES / DES / RC4 in scripts; the grade circle is labelled;
 *                tinkatuff-demo/ — a local page with every flaw planted
 *
 * 0.3.0          easier to read and nicer to look at:
 *                - the report opens with a plain-language summary — one
 *                  line per problem, grouped as "broken today", "can be
 *                  recorded now, unlocked later", "could be faked later",
 *                  "other weak spots" and "already safe"; click a line to
 *                  jump to its detailed card below
 *                - light and dark themes (auto follows the system)
 *                - logo: a built-in hammer, or any picture you choose in
 *                  Settings (kept in Tampermonkey storage, not the file)
 *                - the floating button can be dragged anywhere; the spot
 *                  is remembered, and the panel opens on that side
 *                - Settings tab; exports tucked under one Export button
 *
 * 0.2.0          watches the live site, not just the page source:
 *                - network: every fetch / XHR / WebSocket / beacon /
 *                  EventSource is inspected — Bearer and DPoP tokens,
 *                  HTTP message signatures, keys in API responses, and
 *                  request fields that are RSA-encrypted in the browser
 *                  (e.g. a password sent as a 256-byte blob)
 *                - console: crypto messages, keys and tokens printed to the
 *                  console, CryptoKeys logged, WebCrypto errors
 *                - postMessage traffic between windows (OAuth popups)
 *                - workers, service workers, lazy-loaded JS chunks and
 *                  WebAssembly modules are fetched and scanned
 *                - source maps and CDN URLs → exact crypto npm packages
 *                  (SCA-style, like CBOMkit) and bundle fingerprints
 *                - IndexedDB / localStorage: stored CryptoKeys, JWKs, PEMs
 *                - security.txt PGP keys, did:web documents, Web Push
 *                - pages that take passwords / card data raise TLS severity
 *                  (Mosca: long-shelf-life data)
 *                - Inventory tab with "migrate to" and NIST IR 8547 dates;
 *                  SARIF and Markdown export next to JSON and CBOM
 *
 * 0.1.0          first version — quantum-exposure report for any website:
 *                TLS key exchange, certificate, JWTs, in-page WebCrypto,
 *                crypto libraries, passkeys, WebRTC, published keys,
 *                DNSSEC and DKIM; A–F grade, JSON and CycloneDX CBOM export
 */

/**
 * ============================================================================
 * WHAT IT LOOKS FOR
 * ============================================================================
 * A future quantum computer running Shor's algorithm breaks every public-key
 * scheme the web uses today — RSA, finite-field DH, and all elliptic curves
 * (ECDH, ECDSA, X25519, Ed25519, secp256k1). Symmetric crypto (AES, HMAC,
 * SHA-2) only loses half its bits to Grover and stays fine at 256 bits.
 *
 * So tinkatuff hunts for public-key crypto wherever a site uses it, and sorts
 * each find by HOW it hurts:
 *
 *   harvest now,      key exchange / encryption (TLS without ML-KEM, RSA-OAEP,
 *   decrypt later     ECDH, JWE, WebRTC, Web Push, SRP, E2EE keys). Traffic
 *                     recorded TODAY can be opened later — the urgent ones.
 *
 *   forgery later     signatures (certificates, JWT RS256/ES256, DNSSEC, DKIM,
 *                     passkeys, wallets). Only exploitable once the machine
 *                     exists, but anything trusted for years is at risk.
 *
 * ============================================================================
 * WHERE IT LOOKS
 * ============================================================================
 * Everything below feeds ONE analyser (analyzeText): it finds JWTs (and reads
 * their alg), PEM keys and certificates (parsed for type and size), JWKs
 * (public or private), PGP key blocks, and — in request bodies — values the
 * size of an RSA ciphertext. Every hit becomes a "sighting" with the place it
 * was seen, so the report says what AND where.
 *
 *   runtime hooks      installed at document-start, before the page runs:
 *                      SubtleCrypto (every method), WebAuthn create/get (and
 *                      the algorithm the authenticator actually picked),
 *                      fetch, XHR, WebSocket (out and in), sendBeacon,
 *                      EventSource, Worker / SharedWorker / service worker
 *                      registration, WebAssembly compile/instantiate,
 *                      RTCPeerConnection + certificates, Web Push subscribe,
 *                      console.*, uncaught errors, postMessage.
 *
 *   quick scan         on-page only, nothing leaves the browser: storage,
 *                      cookies, URL, inline scripts, script/CDN URLs, library
 *                      globals, bundle fingerprints, mixed content, forms.
 *
 *   deep scan          on demand (it tells third parties which site you are
 *                      on): edge/CDN of every origin, Cloudflare Radar PQ-TLS
 *                      test (with a token), certificate from crt.sh, DNSSEC,
 *                      DKIM, every JS file the page loaded (incl. lazy chunks,
 *                      workers, service workers) and their source maps, WASM
 *                      binaries, OpenID/JWKS, security.txt PGP key, did.json,
 *                      IndexedDB contents, push subscriptions.
 *
 * Findings are pointers, not proof: a minified bundle can mention "ECDSA"
 * without ever calling it. The runtime sections are what the page really did.
 *
 * A browser extension can't see the TLS handshake. The authoritative check
 * is DevTools → Security (Chrome) or the padlock → Connection details
 * (Firefox): "X25519MLKEM768" there means the connection is hybrid PQ.
 *
 * Console capture wraps console.*, so DevTools shows this script as the
 * source line of every log. Turn it off from the menu while debugging.
 *
 * Install: the file carries its own ==UserScript== header — paste it into
 * Moss or Tampermonkey as is. It must run in the page (@sandbox JavaScript) at
 * document-start: the hooks have to be in before the page's own scripts. Moss
 * starts it before them and still provides GM_xmlhttpRequest, GM_setValue and
 * the menu in page mode. For live reload while editing it, see template.js.
 */

// ==UserScript==
// @name         tinkatuff – quantum exposure scanner
// @namespace    https://github.com/vididvidid/aiutils
// @version      0.4.2
// @description  Finds what on a website a future quantum computer could break: TLS, certs, tokens, network, console, WebCrypto, WASM, passkeys, DNSSEC, DKIM
// @author       vididvidid
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      dns.google
// @connect      crt.sh
// @connect      api.cloudflare.com
// @connect      *
// @sandbox      JavaScript
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.4.2';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const HAS_GM_XHR = typeof GM_xmlhttpRequest === 'function';
  const nativeLog = console.log.bind(console);
  const nativeFetch = W.fetch.bind(W);          // grabbed before the hooks: our own requests stay out of the Network tab
  const SELF_MARK = /@name\s+tinkatuff|const CODE_PATTERNS = \[/;   // never scan this script as if it were the site's
  const LOG = (...a) => nativeLog('[tinkatuff]', ...a);

  // ── 1. Config ─────────────────────────────────────────────────────────────
  const MAX_SCRIPTS        = 80;          // JS files fetched by the deep scan
  const MAX_SCRIPT_BYTES   = 6_000_000;
  const MAX_SOURCEMAPS     = 25;
  const MAX_WASM           = 10;
  const MAX_WASM_BYTES     = 40_000_000;
  const MAX_THIRD_PARTY    = 12;          // third-party origins probed for headers / Radar
  const MAX_BODY_SCAN      = 1_000_000;   // bytes of a request/response body analysed
  const MAX_NET_LOG        = 400;
  const MAX_CONSOLE_LOG    = 200;
  const LONG_TOKEN_DAYS    = 30;          // a signed token living longer than this is worth a mention
  const IDB_MAX_DBS        = 15;
  const IDB_MAX_RECORDS    = 200;         // per object store

  const store = {
    get(k, d) { try { return typeof GM_getValue === 'function' ? GM_getValue(k, d) : d; } catch (_) { return d; } },
    set(k, v) { try { if (typeof GM_setValue === 'function') GM_setValue(k, v); } catch (_) {} },
  };
  const settings = {
    badge:    store.get('badge', true),
    autoDeep: store.get('autoDeep', false),
    radar:    store.get('radarToken', ''),
    console:  store.get('consoleCapture', true),
    network:  store.get('networkCapture', true),
    theme:    store.get('theme', 'auto'),       // auto | light | dark
    logo:     store.get('logo', ''),            // data: URL of a custom logo, '' = built-in
    pos:      store.get('badgePos', null),      // {xr, yr} fractions of the free screen space
  };

  // ── 2. Algorithm knowledge ────────────────────────────────────────────────
  const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'pass'];
  const PENALTY   = { critical: 40, high: 15, medium: 6, low: 2, info: 0, pass: 0 };

  const WHY = {
    hndl:   'Harvest now, decrypt later: data protected by RSA / (EC)DH / discrete-log key exchange can be recorded today and decrypted once a large quantum computer runs Shor\'s algorithm. Anything that must stay secret for years is already exposed.',
    forge:  'Shor\'s algorithm derives RSA / ECC private keys from public keys, so a future quantum attacker could forge these signatures. Not retroactive — it bites once such a machine exists, and hits hardest where trust has to last for years.',
    grover: 'Grover\'s algorithm halves symmetric strength: a 128-bit key behaves like 64 bits. AES-256, SHA-256/384 and HMAC-SHA256 with a 256-bit secret stay safe.',
    pq:     'Uses a NIST post-quantum algorithm (FIPS 203 ML-KEM / FIPS 204 ML-DSA / FIPS 205 SLH-DSA) or a hybrid with one.',
    leak:   'Not a quantum problem — this is exposed to anyone right now.',
    sha1:   'SHA-1 / MD5 are broken classically (practical collisions); quantum changes nothing here — retire them anyway.',
    legacy: 'Broken or outdated today, quantum or not — replace it.',
    hygiene: 'Not a quantum issue — a general security gap worth closing while you are here.',
  };
  const FIX = {
    hndl:  'Move to hybrid X25519 + ML-KEM-768 (e.g. @noble/post-quantum, HPKE with ML-KEM) and tag ciphertexts with an algorithm id so you can rotate later.',
    forge: 'Plan the move to ML-DSA (hybrid ECDSA + ML-DSA during transition) and keep the algorithm configurable.',
  };

  const WEBCRYPTO = {
    'RSA-OAEP':          { kind: 'pke' },
    'RSAES-PKCS1-V1_5':  { kind: 'pke' },
    'RSASSA-PKCS1-V1_5': { kind: 'sig' },
    'RSA-PSS':           { kind: 'sig' },
    'ECDSA':             { kind: 'sig' },
    'ECDH':              { kind: 'ka' },
    'X25519':            { kind: 'ka' },
    'X448':              { kind: 'ka' },
    'ED25519':           { kind: 'sig' },
    'ED448':             { kind: 'sig' },
  };
  const PRIMITIVE = { pke: 'pke', ka: 'key-agree', sig: 'signature' };
  const isPqName = n => /ML-?KEM|ML-?DSA|SLH-?DSA|KYBER|DILITHIUM|SPHINCS|X-?WING|FALCON|FN-DSA/i.test(String(n));

  const OIDS = {
    '1.2.840.113549.1.1.1':  'RSA',
    '1.2.840.113549.1.1.10': 'RSA-PSS',
    '1.2.840.10045.2.1':     'EC',
    '1.3.101.110': 'X25519', '1.3.101.111': 'X448',
    '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448',
    '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521', '1.3.132.0.10': 'secp256k1',
    '1.2.840.113549.1.1.4':  'md5WithRSA',
    '1.2.840.113549.1.1.5':  'sha1WithRSA',
    '1.2.840.113549.1.1.11': 'sha256WithRSA',
    '1.2.840.113549.1.1.12': 'sha384WithRSA',
    '1.2.840.113549.1.1.13': 'sha512WithRSA',
    '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256', '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384', '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
    '2.16.840.1.101.3.4.3.17': 'ML-DSA-44', '2.16.840.1.101.3.4.3.18': 'ML-DSA-65', '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
    '2.16.840.1.101.3.4.4.1': 'ML-KEM-512', '2.16.840.1.101.3.4.4.2': 'ML-KEM-768', '2.16.840.1.101.3.4.4.3': 'ML-KEM-1024',
  };
  for (let i = 20; i <= 31; i++) OIDS[`2.16.840.1.101.3.4.3.${i}`] = 'SLH-DSA';

  const NIST_LEVEL = { 'ML-KEM-512': 1, 'ML-KEM-768': 3, 'ML-KEM-1024': 5, 'ML-DSA-44': 2, 'ML-DSA-65': 3, 'ML-DSA-87': 5, X25519MLKEM768: 3 };

  // COSE algorithm ids used by WebAuthn
  const COSE = { '-7': 'ES256', '-35': 'ES384', '-36': 'ES512', '-8': 'EdDSA', '-257': 'RS256', '-258': 'RS384',
                 '-259': 'RS512', '-37': 'PS256', '-38': 'PS384', '-39': 'PS512', '-47': 'ES256K',
                 '-48': 'ML-DSA-44', '-49': 'ML-DSA-65', '-50': 'ML-DSA-87' };

  const DNSSEC_ALG = { 1: 'RSAMD5', 5: 'RSASHA1', 7: 'RSASHA1-NSEC3-SHA1', 8: 'RSASHA256', 10: 'RSASHA512',
                       13: 'ECDSAP256SHA256', 14: 'ECDSAP384SHA384', 15: 'ED25519', 16: 'ED448' };

  // OpenPGP public-key algorithm ids (RFC 9580; 30–36 from draft-ietf-openpgp-pqc)
  const PGP_ALG = { 1: 'RSA', 2: 'RSA', 3: 'RSA', 16: 'ElGamal', 17: 'DSA', 18: 'ECDH', 19: 'ECDSA', 22: 'EdDSA (legacy)',
                    25: 'X25519', 26: 'X448', 27: 'Ed25519', 28: 'Ed448', 30: 'ML-DSA-65+Ed25519', 31: 'ML-DSA-87+Ed448',
                    32: 'SLH-DSA-SHAKE-128s', 33: 'SLH-DSA-SHAKE-128f', 34: 'SLH-DSA-SHAKE-256s', 35: 'ML-KEM-768+X25519', 36: 'ML-KEM-1024+X448' };
  const PGP_ENC = new Set([1, 2, 16, 18, 25, 26, 35, 36]);

  // did:key / Multikey prefixes
  const MULTIBASE = [['z6Mk', 'Ed25519'], ['z6LS', 'X25519'], ['zDn', 'P-256'], ['z82', 'P-384'], ['zQ3s', 'secp256k1']];

  const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 's1', 's2', 'dkim',
    'mail', 'smtp', 'mandrill', 'mxvault', 'zendesk1', 'zendesk2', 'fm1', 'fm2', 'protonmail', 'pm',
    'sig1', 'key1', 'dk', 'everlytickey1', 'cm', 'mailjet', 'sendgrid', 'amazonses', 's1024', 'hs1'];

  // Crypto-relevant npm packages. Matched by exact name (source maps, CDN
  // URLs), by window globals, by script file name (src), and by a fingerprint
  // that survives minification (fp; an optional capture group is the version).
  const IDP = { label: 'identity SDK — tokens it handles are signed by the provider, usually RS256', sev: 'info', why: 'forge' };
  const WALLET = { label: 'blockchain keys: secp256k1 ECDSA / Schnorr', sev: 'medium', why: 'forge' };
  const PKGS = {
    'jsencrypt':          { label: 'RSA PKCS#1 v1.5 encryption', sev: 'high', why: 'hndl', globals: ['JSEncrypt'], src: /jsencrypt/i, fp: /\bJSEncrypt\b/ },
    'node-rsa':           { label: 'RSA encryption / signatures', sev: 'high', why: 'hndl', globals: ['NodeRSA'], src: /node-rsa/i },
    'openpgp':            { label: 'OpenPGP (RSA / Curve25519 / NIST P)', sev: 'high', why: 'hndl', globals: ['openpgp'], src: /openpgp/i, fp: /OpenPGP\.js v?(\d+\.\d+\.\d+)/ },
    'tweetnacl':          { label: 'X25519 box, Ed25519', sev: 'high', why: 'hndl', globals: ['nacl'], src: /tweetnacl|\bnacl(-fast)?(\.min)?\.js/i, fp: /crypto_box_PUBLICKEYBYTES/ },
    'libsodium-wrappers': { label: 'X25519, Ed25519 (libsodium)', sev: 'high', why: 'hndl', globals: ['sodium'], src: /libsodium|\bsodium(\.min)?\.js/i, fp: /sodium_version_string|crypto_box_curve25519xsalsa20poly1305/ },
    'olm':                { label: 'Olm / Megolm E2EE (Curve25519)', sev: 'high', why: 'hndl', globals: ['Olm'], src: /\bolm(\.min)?\.js|olm\.wasm/i, fp: /olm_create_account/ },
    '@matrix-org/matrix-sdk-crypto-wasm': { label: 'Matrix E2EE (Curve25519)', sev: 'high', why: 'hndl', fp: /matrix_sdk_crypto/ },
    'node-forge':         { label: 'RSA, X.509, TLS in JavaScript', sev: 'medium', why: 'hndl', globals: ['forge'], src: /node-forge|\bforge(\.min)?\.js/i, fp: /forge\.pki\b|pki\.rsa\.(?:generateKeyPair|setPublicKey)/ },
    'sjcl':               { label: 'ECC (P-256) + AES', sev: 'medium', why: 'hndl', globals: ['sjcl'], src: /\bsjcl/i },
    'create-ecdh':        { label: 'ECDH (crypto-browserify)', sev: 'medium', why: 'hndl', fp: /\bcreateECDH\b/ },
    'diffie-hellman':     { label: 'finite-field Diffie–Hellman (crypto-browserify)', sev: 'medium', why: 'hndl', fp: /\bcreateDiffieHellman(?:Group)?\b/ },
    'public-encrypt':     { label: 'RSA encryption (crypto-browserify)', sev: 'medium', why: 'hndl' },
    'crypto-browserify':  { label: 'Node crypto polyfill (ships RSA, DH, ECDH)', sev: 'low', why: 'hndl' },
    'browserify-sign':    { label: 'RSA / ECDSA signatures (crypto-browserify)', sev: 'low', why: 'forge' },
    'hpke-js':            { label: 'HPKE with classical DHKEM (X25519 / P-256)', sev: 'medium', why: 'hndl', fp: /DHKEM\((?:X25519|P-256)/ },
    '@hpke/core':         { label: 'HPKE with classical DHKEM (X25519 / P-256)', sev: 'medium', why: 'hndl' },
    '@hpke/dhkem-x25519': { label: 'HPKE DHKEM(X25519)', sev: 'medium', why: 'hndl' },
    'amazon-cognito-identity-js': { label: 'SRP-6a login (2048-bit discrete-log group)', sev: 'medium', why: 'hndl', globals: ['AmazonCognitoIdentity'], fp: /USER_SRP_AUTH/ },
    'secure-remote-password': { label: 'SRP-6a login (discrete log)', sev: 'medium', why: 'hndl' },
    'thinbus-srp':        { label: 'SRP-6a login (discrete log)', sev: 'medium', why: 'hndl' },
    'jsrsasign':          { label: 'RSA / ECDSA signatures, X.509', sev: 'medium', why: 'forge', globals: ['KJUR'], src: /jsrsasign/i, fp: /KJUR\.(?:crypto|asn1|jws)\b/ },
    'elliptic':           { label: 'ECDSA / ECDH (secp256k1, P-256, Curve25519)', sev: 'medium', why: 'forge', globals: ['elliptic'], src: /\belliptic(\.min)?\.js/i, fp: /\bkeyFromPrivate\b/ },
    '@noble/curves':      { label: 'ECC (secp256k1, P-256, Ed25519, X25519)', sev: 'medium', why: 'forge' },
    '@noble/secp256k1':   { label: 'secp256k1 ECDSA / Schnorr', sev: 'medium', why: 'forge' },
    '@noble/ed25519':     { label: 'Ed25519 signatures', sev: 'medium', why: 'forge' },
    'secp256k1':          { label: 'secp256k1 ECDSA', sev: 'medium', why: 'forge' },
    'ethers':             { ...WALLET, globals: ['ethers'], src: /\bethers(\.umd)?(\.min)?\.js|\/ethers@/i, fp: /"ethers\/(\d+\.\d+\.\d+)"/ },
    'web3':               { ...WALLET, globals: ['Web3'], src: /\bweb3(\.min)?\.js|\/web3@/i },
    'viem':               { ...WALLET },
    'bitcoinjs-lib':      { ...WALLET, globals: ['bitcoinjs'], src: /bitcoinjs/i },
    'tronweb':            { ...WALLET, globals: ['TronWeb'] },
    '@cosmjs/crypto':     { ...WALLET },
    '@solana/web3.js':    { label: 'blockchain keys: Ed25519 (Solana)', sev: 'medium', why: 'forge', globals: ['solanaWeb3'], src: /solana.*web3/i },
    'jose':               { label: 'JOSE / JWT (RSA, ECDSA, EdDSA)', sev: 'low', why: 'forge', fp: /ERR_JWS_SIGNATURE_VERIFICATION_FAILED/ },
    'jsonwebtoken':       { label: 'JWT signing (RS*/ES*)', sev: 'low', why: 'forge' },
    'jws':                { label: 'JWS signing (RS*/ES*)', sev: 'low', why: 'forge' },
    '@peculiar/x509':     { label: 'X.509 in the browser', sev: 'low', why: 'forge' },
    '@peculiar/webcrypto': { label: 'WebCrypto polyfill (RSA / EC)', sev: 'low', why: 'forge' },
    'pkijs':              { label: 'X.509 / CMS in the browser', sev: 'low', why: 'forge' },
    '@simplewebauthn/browser': { label: 'passkeys — ES256 / RS256 unless told otherwise', sev: 'info', why: 'forge', globals: ['SimpleWebAuthnBrowser'] },
    'firebase':           { ...IDP, globals: ['firebase'] },
    '@firebase/auth':     { ...IDP },
    '@azure/msal-browser': { ...IDP, globals: ['msal'] },
    '@auth0/auth0-spa-js': { ...IDP, globals: ['createAuth0Client', 'auth0'] },
    '@okta/okta-auth-js': { ...IDP, globals: ['OktaAuth'] },
    'keycloak-js':        { ...IDP, globals: ['Keycloak'] },
    '@clerk/clerk-js':    { ...IDP, globals: ['Clerk'] },
    '@supabase/supabase-js': { ...IDP, globals: ['supabase'] },
    'oidc-client-ts':     { ...IDP },
    'oidc-client':        { ...IDP, globals: ['Oidc'] },
    '@signalapp/libsignal-client': { label: 'Signal protocol (PQXDH adds ML-KEM-1024)', sev: 'info', why: 'pq', fp: /PQXDH/ },
    'crypto-js':          { label: 'AES / SHA / HMAC (symmetric only)', sev: 'info', why: 'grover', globals: ['CryptoJS'], src: /crypto-js|cryptojs/i },
    '@noble/post-quantum': { label: 'ML-KEM / ML-DSA / SLH-DSA', sev: 'pass', why: 'pq', src: /noble[-\/]post-quantum/i },
    '@hpke/ml-kem':       { label: 'HPKE with ML-KEM', sev: 'pass', why: 'pq' },
    '@hpke/hybridkem-x-wing': { label: 'HPKE with X-Wing (X25519 + ML-KEM-768)', sev: 'pass', why: 'pq' },
    'mlkem':              { label: 'ML-KEM', sev: 'pass', why: 'pq' },
    'crystals-kyber':     { label: 'Kyber / ML-KEM', sev: 'pass', why: 'pq' },
    'pqc':                { label: 'post-quantum algorithms', sev: 'pass', why: 'pq' },
    'liboqs':             { label: 'NIST PQ algorithms (WASM)', sev: 'pass', why: 'pq', src: /liboqs/i },
  };

  // Static patterns for script source. Minified bundles often carry algorithm
  // names from libraries that never use them, so these are "referenced", not
  // "used" — the runtime hooks are the proof.
  const CODE_PATTERNS = [
    { id: 'rsa-oaep',  re: /["'`]RSA-OAEP(?:-256|-384|-512)?["'`]/,          label: 'RSA-OAEP encryption',     sev: 'medium', why: 'hndl' },
    { id: 'ecdh',      re: /["'`](?:ECDH|ECDH-ES(?:\+A\d+KW)?)["'`]/,       label: 'ECDH key agreement',      sev: 'medium', why: 'hndl' },
    { id: 'x25519',    re: /["'`]X25519["'`]/,                              label: 'X25519 key agreement',    sev: 'medium', why: 'hndl' },
    { id: 'rsa-sig',   re: /["'`](?:RSASSA-PKCS1-v1_5|RSA-PSS|RS256|PS256)["'`]/, label: 'RSA signatures',    sev: 'low',    why: 'forge' },
    { id: 'ecdsa',     re: /["'`](?:ECDSA|ES256|ES384)["'`]/,               label: 'ECDSA signatures',        sev: 'low',    why: 'forge' },
    { id: 'ed25519',   re: /["'`](?:Ed25519|EdDSA)["'`]/,                   label: 'Ed25519 signatures',      sev: 'low',    why: 'forge' },
    { id: 'secp256k1', re: /secp256k1/,                                     label: 'secp256k1 (crypto-wallet curve)', sev: 'low', why: 'forge' },
    { id: 'webauthn',  re: /navigator\.credentials\.create\s*\(|PublicKeyCredential\.isUserVerifyingPlatformAuthenticatorAvailable/, label: 'passkey / WebAuthn registration', sev: 'info', why: 'forge' },
    { id: 'webpush',   re: /pushManager\.subscribe\s*\(|applicationServerKey/, label: 'Web Push (ECDH P-256 message encryption)', sev: 'low', why: 'hndl' },
    { id: 'legacy',    re: /CryptoJS\.(?:TripleDES|DES|RC4|Rabbit)\b|["'`](?:DES-EDE3(?:-CBC)?|des-ede3(?:-cbc)?|3DES|RC4|rc4)["'`]/, label: '3DES / DES / RC4 (broken legacy ciphers)', sev: 'medium', why: 'legacy' },
    { id: 'sha1',      re: /["'`]SHA-1["'`]|\bCryptoJS\.(?:SHA1|MD5)\b/,     label: 'SHA-1 / MD5 hashing',     sev: 'low',    why: 'sha1' },
    { id: 'pq',        re: /["'`](?:ML-KEM-(?:512|768|1024)|ML-DSA-(?:44|65|87)|X25519MLKEM768|SLH-DSA[^"'`]*)["'`]|ml_kem768|ml_dsa65|x[-_]?wing/i, label: 'post-quantum algorithms (ML-KEM / ML-DSA)', sev: 'pass', why: 'pq' },
  ];

  // Symbols that survive inside WebAssembly binaries (export/import names, strings)
  const WASM_SIGS = [
    { id: 'rsa',    re: /RSA_(?:public_encrypt|private_decrypt|sign|verify|generate_key)|mbedtls_rsa_|rsa_pkcs1|rsa_oaep|wc_RsaPublicEncrypt/i, label: 'RSA', sev: 'medium', why: 'hndl' },
    { id: 'ecdh',   re: /ECDH_compute_key|mbedtls_ecdh_|EC_KEY_generate_key|wc_ecc_shared_secret|ecdh_compute/i,                         label: 'ECDH',     sev: 'medium', why: 'hndl' },
    { id: 'x25519', re: /crypto_box_(?:keypair|easy)|crypto_scalarmult|x25519|curve25519/i,                                              label: 'X25519',   sev: 'medium', why: 'hndl' },
    { id: 'ecdsa',  re: /ECDSA_(?:do_)?sign|mbedtls_ecdsa_|wc_ecc_sign_hash|ecdsa_sign/i,                                                label: 'ECDSA',    sev: 'low',    why: 'forge' },
    { id: 'ed25519', re: /ed25519/i,                                                                                                    label: 'Ed25519',  sev: 'low',    why: 'forge' },
    { id: 'secp256k1', re: /secp256k1/i,                                                                                                label: 'secp256k1', sev: 'low',   why: 'forge' },
    { id: 'tlslib', re: /OpenSSL \d\.\d|BoringSSL|mbed ?TLS|wolfSSL/,                                                                    label: 'a TLS / crypto library (OpenSSL, BoringSSL, mbedTLS or wolfSSL)', sev: 'info', why: 'hndl' },
    { id: 'pq',     re: /OQS_KEM|OQS_SIG|pqcrystals|ml_kem|mlkem|kyber|dilithium|ml_dsa|sphincs/i,                                       label: 'post-quantum algorithms', sev: 'pass', why: 'pq' },
  ];

  // ── 3. Small helpers & parsers ────────────────────────────────────────────
  const tagOf = v => Object.prototype.toString.call(v);
  const abs = u => { try { return new URL(String(u), location.href).href; } catch (_) { return String(u); } };
  const shortUrl = u => { try { const x = new URL(u); return (x.host + x.pathname).slice(0, 90); } catch (_) { return String(u).slice(0, 90); } };

  function b64ToBytes(s) {
    s = String(s).replace(/\\n|\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlJson(s) {
    try { return JSON.parse(new TextDecoder().decode(b64ToBytes(s))); } catch (_) { return null; }
  }

  const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){1,3}/g;
  const PEM_RE = /-----BEGIN ((?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY|PUBLIC KEY|RSA PUBLIC KEY|CERTIFICATE|PGP PUBLIC KEY BLOCK)-----[\s\S]{20,20000}?-----END \1-----/g;
  const JWK_RE = /\{[^{}]{0,4000}?"kty"\s*:\s*"(?:RSA|EC|OKP|AKP)"[^{}]{0,8000}?\}/g;

  // Never keep tokens or key material in what is shown or exported.
  function redact(s) {
    return String(s)
      .replace(JWT_RE, m => m.slice(0, 10) + '…[JWT]')
      .replace(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g, '[$1]');
  }

  // Minimal DER reader: enough to walk a certificate / SubjectPublicKeyInfo.
  function der(b, pos) {
    const tag = b[pos];
    let len = b[pos + 1], hdr = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + b[pos + 2 + i];
      hdr += n;
    }
    return { tag, start: pos + hdr, end: pos + hdr + len };
  }
  function kids(b, node) {
    const out = [];
    for (let p = node.start; p < node.end;) { const c = der(b, p); out.push(c); p = c.end; }
    return out;
  }
  function oid(b, node) {
    const parts = [];
    let v = 0;
    for (let i = node.start; i < node.end; i++) {
      v = v * 128 + (b[i] & 0x7f);
      if (!(b[i] & 0x80)) {
        if (!parts.length) { const f = Math.min(Math.floor(v / 40), 2); parts.push(f, v - 40 * f); }
        else parts.push(v);
        v = 0;
      }
    }
    return parts.join('.');
  }
  function intBits(b, node) {
    let n = node.end - node.start, i = node.start;
    while (n > 0 && b[i] === 0) { n--; i++; }
    return n * 8;
  }

  // SubjectPublicKeyInfo → { name: 'RSA-2048' | 'EC P-256' | 'ML-DSA-65' …, fam, bits, pq }
  function describeSpki(b, node = der(b, 0)) {
    const [algId, bits] = kids(b, node);
    const [algOid, params] = kids(b, algId);
    const a = OIDS[oid(b, algOid)] || oid(b, algOid);
    if (a === 'RSA' || a === 'RSA-PSS') {
      const n = intBits(b, kids(b, der(b, bits.start + 1))[0]);
      return { name: `RSA-${n}`, fam: 'RSA', bits: n, pq: false };
    }
    if (a === 'EC') {
      const curve = params && params.tag === 0x06 ? (OIDS[oid(b, params)] || oid(b, params)) : '?';
      return { name: `EC ${curve}`, fam: 'ECC', pq: false };
    }
    if (/^(X|Ed)(25519|448)$/.test(a)) return { name: a, fam: 'ECC', pq: false };
    if (isPqName(a)) return { name: a, fam: 'PQ', pq: true };
    return { name: a, fam: '?', pq: false };
  }
  function describePkcs1(b) {
    const n = intBits(b, kids(b, der(b, 0))[0]);
    return { name: `RSA-${n}`, fam: 'RSA', bits: n, pq: false };
  }
  function describeCert(b) {
    const [tbs, sigAlg] = kids(b, der(b, 0));
    const t = kids(b, tbs);
    const i = t[0].tag === 0xa0 ? 1 : 0;           // optional [0] version
    const sigOid = oid(b, kids(b, sigAlg)[0]);
    return { key: describeSpki(b, t[i + 5]), sig: OIDS[sigOid] || sigOid };
  }
  const pemToDer = pem => b64ToBytes(pem.replace(/-----[^-]+-----/g, ''));

  function describeJwk(k) {
    if (!k || typeof k !== 'object') return null;
    const priv = 'd' in k;
    if (k.kty === 'RSA') { const bits = k.n ? Math.round(String(k.n).length * 6 / 8 / 8) * 64 : 0; return { name: `RSA-${bits || '?'}`, fam: 'RSA', bits, priv }; }
    if (k.kty === 'EC') return { name: `EC ${k.crv}`, fam: 'ECC', priv };
    if (k.kty === 'OKP') return { name: String(k.crv), fam: 'ECC', priv };
    if (k.kty === 'AKP') return { name: String(k.alg || 'AKP'), fam: 'PQ', pq: true, priv };
    return null;
  }

  // OpenPGP armored block → [{role, name, alg, pq, enc}]
  function pgpPackets(armored) {
    const m = armored.match(/-----BEGIN PGP [A-Z ]+-----\r?\n([\s\S]*?)-----END PGP/);
    if (!m) return [];
    const lines = m[1].split(/\r?\n/);
    const blank = lines.findIndex(l => !l.trim());
    const b64 = lines.slice(blank >= 0 ? blank + 1 : 0).filter(l => l && !l.startsWith('=')).join('');
    const b = b64ToBytes(b64);
    const out = [];
    for (let p = 0; p < b.length;) {
      const h0 = b[p];
      if (!(h0 & 0x80)) break;
      let tag, len, hdr;
      if (h0 & 0x40) {
        tag = h0 & 0x3f;
        const l0 = b[p + 1];
        if (l0 < 192) { len = l0; hdr = 2; }
        else if (l0 < 224) { len = ((l0 - 192) << 8) + b[p + 2] + 192; hdr = 3; }
        else if (l0 === 255) { len = ((b[p + 2] << 24) | (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]) >>> 0; hdr = 6; }
        else break;                                  // partial body lengths: not in key blocks
      } else {
        tag = (h0 >> 2) & 0xf;
        const lt = h0 & 3;
        if (lt === 0) { len = b[p + 1]; hdr = 2; }
        else if (lt === 1) { len = (b[p + 1] << 8) | b[p + 2]; hdr = 3; }
        else if (lt === 2) { len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0; hdr = 5; }
        else break;
      }
      const body = b.subarray(p + hdr, p + hdr + len);
      if (tag === 6 || tag === 14) {
        const alg = body[5];
        let name = PGP_ALG[alg] || `alg ${alg}`;
        if (alg >= 1 && alg <= 3 && body[0] === 4) name = `RSA-${(body[6] << 8) | body[7]}`;
        out.push({ role: tag === 6 ? 'primary key' : 'subkey', name, alg, pq: alg >= 30 && alg <= 36, enc: PGP_ENC.has(alg) });
      } else if (tag === 2) {
        const alg = body[0] === 3 ? body[15] : body[2];
        out.push({ role: 'signature', name: PGP_ALG[alg] || `alg ${alg}`, alg, pq: alg >= 30 && alg <= 36, enc: false });
      }
      p += hdr + len;
    }
    return out;
  }

  // Bounded JSON-ish rendering of console arguments (never walks huge objects).
  function brief(v, depth = 0, budget = { n: 300 }) {
    if (budget.n-- <= 0) return '…';
    if (v == null || typeof v !== 'object') return typeof v === 'string' ? (depth ? JSON.stringify(v) : v) : String(v);
    try {
      if (tagOf(v) === '[object CryptoKey]') return `CryptoKey{${v.type} ${v.algorithm && v.algorithm.name}${v.algorithm && v.algorithm.namedCurve ? ' ' + v.algorithm.namedCurve : ''}${v.algorithm && v.algorithm.modulusLength ? ' ' + v.algorithm.modulusLength : ''}}`;
      if (v instanceof Error || /Error\]$|DOMException/.test(tagOf(v))) return `${v.name}: ${v.message}`;
      if (depth >= 3) return Array.isArray(v) ? '[…]' : '{…}';
      if (Array.isArray(v)) return '[' + v.slice(0, 30).map(x => brief(x, depth + 1, budget)).join(',') + ']';
      return '{' + Object.keys(v).slice(0, 40).map(k => `"${k}":${brief(v[k], depth + 1, budget)}`).join(',') + '}';
    } catch (_) { return '[object]'; }
  }

  // ── 4. Observations & sightings ───────────────────────────────────────────
  const obs = {
    crypto:   new Map(),   // "op|ALG|param" → {op, alg, param, count, where}
    webauthn: [],          // {op, algs, chosen, rp, where}
    sockets:  new Map(),   // url → {count, where}
    rtc:      { count: 0, where: new Set() },
    net:      [],          // {kind, method, url, status, flags}
    console:  [],          // {level, text, flags, where}
    workers:  new Set(),   // worker / service-worker script URLs
    wasmUrls: new Set(),
    wasmSeen: new Set(),   // cheap fingerprints of modules already scanned
  };
  const sightings = new Map();     // id → finding-like record with a growing evidence set
  const liveTokens = new Map();    // JWT kind → group
  const tokenIssuers = new Set();
  const packages = new Map();      // npm name → {versions, where}

  // This script's own URL, so its frames are skipped when naming the caller.
  const OWN_SRC = (() => {
    try { const m = String(new Error().stack).match(/([a-z-]+:\/\/[^\s()]+?):\d+:\d+/); return m ? m[1] : ''; } catch (_) { return ''; }
  })();

  function callerSite() {
    try {
      for (const line of String(new Error().stack || '').split('\n')) {
        const m = line.match(/(https?:\/\/[^\s()]+?):(\d+):(\d+)/);
        if (m && m[1] !== OWN_SRC) return m[0];
      }
    } catch (_) {}
    return '';
  }

  function remember(map, key, base, where) {
    let e = map.get(key);
    if (!e) { e = { ...base, count: 0, where: new Set() }; map.set(key, e); }
    e.count++;
    if (where && e.where.size < 8) e.where.add(where);
  }

  function sight(id, def, where) {
    let s = sightings.get(id);
    if (!s) { s = { ...def, where: new Set(), count: 0 }; sightings.set(id, s); }
    s.count++;
    if (where && s.where.size < 15) s.where.add(redact(where));
    scheduleQuick();
  }

  function pkgSeen(name, version, where) {
    if (!PKGS[name]) return;
    const p = packages.get(name) || { versions: new Set(), where: new Set() };
    if (version) p.versions.add(version);
    if (where && p.where.size < 10) p.where.add(where);
    packages.set(name, p);
  }

  // Where a thing was seen decides which report section it lands in.
  function catFor(where) {
    if (/^(localStorage|sessionStorage|cookie|IndexedDB|page URL)/.test(where)) return 'stored';
    if (/^console|^uncaught/.test(where)) return 'console';
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|WebSocket|beacon|postMessage)\b/.test(where)) return 'network';
    return 'keys';
  }
  const isExposedPlace = where => !/^(localStorage|sessionStorage|IndexedDB|cookie)/.test(where);

  // ── 5. The analyser: JWT / PEM / JWK / PGP / RSA-sized blobs in any text ──
  function jwtFinding(token, where) {
    const parts = token.split('.');
    const head = b64urlJson(parts[0]);
    if (!head || !head.alg) return null;
    const alg = String(head.alg);
    const isJwe = parts.length === 5;
    const body = isJwe ? null : b64urlJson(parts[1]);
    let days = 0;
    if (body && body.exp) days = (body.exp - (body.iat || Date.now() / 1000)) / 86400;
    if (body && typeof body.iss === 'string' && /^https:\/\//.test(body.iss)) tokenIssuers.add(body.iss.replace(/\/$/, ''));
    const label = `${where} (${isJwe ? 'JWE' : 'JWT'} ${alg}${head.enc ? ' / ' + head.enc : ''}${body && body.iss ? ' · iss ' + body.iss : ''}${days > 1 ? ` · lives ${Math.round(days)} days` : ''})`;
    const base = { label, alg };
    if (String(head.typ).toLowerCase() === 'dpop+jwt') return { ...base, key: `dpop-${alg}`, sev: isPqName(alg) ? 'pass' : 'medium', kind: 'sig',
      title: `DPoP proof-of-possession keys use ${alg}`,
      plain: isPqName(alg) ? 'Login proof keys are post-quantum.' : 'Login proof keys use signatures a quantum computer could fake.', why: isPqName(alg) ? WHY.pq : WHY.forge,
      fix: 'Sender-constrained tokens are good practice — move the DPoP key to ML-DSA when your auth server supports it.' };
    if (isJwe) {
      if (/^(RSA|ECDH)/i.test(alg)) return { ...base, key: `jwe-${alg}`, sev: 'high', kind: 'pke', title: `Encrypted token (JWE) keyed with ${alg}`, plain: 'Encrypted login tokens could be recorded now and unlocked later by a quantum computer.', why: WHY.hndl,
        fix: 'Wrap the content key with ML-KEM (hybrid with ECDH-ES during the move), or use dir / A256KW with a server-held key.' };
      return { ...base, key: `jwe-${alg}`, sev: 'pass', kind: 'pke', title: `Encrypted token (JWE) uses symmetric ${alg}`, plain: 'Encrypted login tokens use quantum-safe encryption.', why: WHY.grover };
    }
    if (alg === 'none') return { ...base, key: 'jwt-none', sev: 'critical', title: 'Unsigned JWT (alg: none)', plain: 'Login tokens are not signed — anyone can fake them today.', why: WHY.leak, fix: 'Reject alg none; sign every token.' };
    if (/^HS/.test(alg)) return { ...base, key: `jwt-${alg}`, sev: 'pass', kind: 'mac', title: `JWT signed with ${alg} (symmetric HMAC)`, plain: 'Login tokens use a quantum-safe signature (HMAC).', why: WHY.grover, fix: 'Keep the secret at least 256 bits.' };
    if (isPqName(alg)) return { ...base, key: `jwt-${alg}`, sev: 'pass', kind: 'sig', title: `JWT signed with ${alg}`, plain: 'Login tokens use a post-quantum signature.', why: WHY.pq };
    if (/^(RS|PS|ES|EdDSA|Ed25519|Ed448)/.test(alg)) {
      return { ...base, key: `jwt-${alg}`, sev: days > LONG_TOKEN_DAYS ? 'medium' : 'low', kind: 'sig',
        title: `JWT signed with ${alg} (${/^(RS|PS)/.test(alg) ? 'RSA' : 'elliptic curve'})`,
        plain: `Login tokens are signed with ${/^(RS|PS)/.test(alg) ? 'RSA' : 'elliptic-curve'} keys — a quantum computer could fake them.`, why: WHY.forge,
        fix: 'Plan for ML-DSA (JOSE "ML-DSA-65", draft-ietf-cose-dilithium) and keep the alg configurable; short lifetimes limit the window.' };
    }
    return null;
  }

  function tokenSeen(token, where, flags) {
    const f = jwtFinding(token, where);
    if (!f) return;
    if (flags) flags.push(`JWT ${f.alg}`);
    const g = liveTokens.get(f.key) || { ...f, where: [] };
    if (!g.where.includes(f.label) && g.where.length < 15) g.where.push(f.label);
    liveTokens.set(f.key, g);
  }

  function keyDef(desc, what, where, { enc = false } = {}) {
    const weak = desc.fam === 'RSA' && desc.bits && desc.bits < 2048;
    const sev = desc.pq ? 'pass' : weak ? 'high' : enc ? 'medium' : 'low';
    return {
      cat: catFor(where), sev, title: `${what}: ${desc.name}`,
      plain: desc.pq ? `${what} uses post-quantum crypto (${desc.name}).`
        : weak ? `${what} (${desc.name}) is too short — weak even today.`
        : enc ? `${what} (${desc.name}): anything encrypted to it could be unlocked later by a quantum computer.`
        : `${what} (${desc.name}) is exposed — a quantum computer could work out its secret half.`,
      detail: weak ? 'Under 2048 bits is breakable classically already.' : desc.pq ? '' : enc
        ? 'An encryption / key-agreement key: whatever is encrypted to it today can be stored and opened later.'
        : 'A published public key is exactly the input Shor\'s algorithm needs.',
      why: desc.pq ? WHY.pq : enc ? WHY.hndl : WHY.forge, fix: desc.pq ? '' : enc ? FIX.hndl : FIX.forge,
      assets: [{ name: desc.name, primitive: enc ? 'pke' : 'signature' }],
    };
  }

  function privateKeyDef(name, where) {
    const exposed = isExposedPlace(where);
    return {
      cat: catFor(where), sev: exposed ? 'critical' : 'medium',
      title: exposed ? `Private key exposed (${name})` : `Private key kept in readable browser storage (${name})`,
      plain: exposed ? 'A secret (private) key is visible to anyone — treat it as stolen.' : 'A secret key is stored where any script on this site could read it.',
      detail: exposed ? 'Anyone who sees this traffic / console / script has the key — it is compromised already.'
        : 'Any script on the origin (one XSS) can read it. Prefer non-extractable CryptoKeys in IndexedDB.',
      why: WHY.leak, fix: exposed ? 'Revoke and rotate the key now; never send or log private keys.' : 'Store keys as non-extractable CryptoKey objects.',
    };
  }

  function pemSeen(kind, pem, where, flags) {
    // a real PEM body is base64 lines; code that *builds* a PEM (`-----BEGIN…${key}…`) is not a leak
    const bodyText = pem.replace(/-----[^-]+-----/g, '').replace(/\\n|\\r/g, '');
    if (kind !== 'PGP PUBLIC KEY BLOCK' && !/^[\sA-Za-z0-9+/=]{40,}$/.test(bodyText)) return;
    if (/PRIVATE KEY/.test(kind)) {
      if (flags) flags.push('PRIVATE KEY');
      sight(`priv-${catFor(where)}-${kind}`, privateKeyDef(kind.replace(/ ?PRIVATE KEY/, '') || 'PKCS#8', where), where);
      return;
    }
    try {
      if (kind === 'PGP PUBLIC KEY BLOCK') {
        for (const k of pgpPackets(pem)) {
          if (k.role === 'signature') continue;
          if (flags) flags.push(`PGP ${k.name}`);
          sight(`pgp-${k.name}-${k.role}`, keyDef({ name: k.name, pq: k.pq, fam: /RSA/.test(k.name) ? 'RSA' : 'ECC', bits: +(k.name.match(/RSA-(\d+)/) || [])[1] },
            `PGP ${k.role}`, where, { enc: k.enc }), where);
        }
        return;
      }
      const b = pemToDer(pem);
      const desc = kind === 'CERTIFICATE' ? describeCert(b).key : kind === 'RSA PUBLIC KEY' ? describePkcs1(b) : describeSpki(b);
      if (flags) flags.push(`${kind === 'CERTIFICATE' ? 'cert' : 'key'} ${desc.name}`);
      sight(`pem-${catFor(where)}-${kind}-${desc.name}`, keyDef(desc, kind === 'CERTIFICATE' ? 'Certificate' : 'Public key', where), where);
    } catch (_) {}
  }

  function jwkSeen(jwk, where, flags) {
    const d = describeJwk(jwk);
    if (!d) return;
    if (flags) flags.push(`JWK ${d.name}${d.priv ? ' (private!)' : ''}`);
    if (d.priv) { sight(`priv-${catFor(where)}-jwk-${d.name}`, privateKeyDef(`JWK ${d.name}`, where), where); return; }
    const enc = jwk.use === 'enc' || /^(RSA-OAEP|RSA1_5|ECDH)/.test(jwk.alg || '') || (jwk.key_ops || []).some(o => /encrypt|wrap|derive/.test(o));
    sight(`jwk-${catFor(where)}-${d.name}-${enc}`, keyDef(d, enc ? 'Encryption key (JWK)' : 'Public key (JWK)', where, { enc }), where);
  }

  const RSA_SIZES = new Set([128, 256, 384, 512]);
  function rsaSized(v) {
    v = String(v).trim();
    if (v.length >= 170 && v.length <= 690 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
      try { const n = b64ToBytes(v).length; if (RSA_SIZES.has(n)) return n; } catch (_) {}
    }
    if (/^(?:[0-9a-f]{256}|[0-9a-f]{512}|[0-9a-f]{768}|[0-9a-f]{1024})$/i.test(v)) return v.length / 2;
    return 0;
  }

  function walkJson(v, fn, depth = 0, budget = { n: 2000 }) {
    if (budget.n-- <= 0 || depth > 6 || v == null) return;
    if (Array.isArray(v)) v.forEach(x => walkJson(x, fn, depth + 1, budget));
    else if (typeof v === 'object') for (const k of Object.keys(v)) { typeof v[k] === 'string' ? fn(k, v[k]) : walkJson(v[k], fn, depth + 1, budget); }
  }

  // Request bodies: values that look like RSA ciphertexts, push subscriptions.
  function bodySniff(text, where, flags) {
    const fields = [];
    try { walkJson(JSON.parse(text), (k, v) => fields.push([k, v])); }
    catch (_) {
      if (text.includes('=') && !/\s/.test(text.slice(0, 200))) { try { for (const [k, v] of new URLSearchParams(text)) fields.push([k, v]); } catch (_) {} }
    }
    if (!fields.length) fields.push(['body', text]);
    for (const [k, v] of fields) {
      if (/^p256dh$/i.test(k)) {
        if (flags) flags.push('Web Push key');
        sight('webpush-sub', WEBPUSH_DEF, where);
      }
      const n = rsaSized(v);
      if (!n) continue;
      const secret = /pass|pwd|pin|secret|card|cvv|cvc|otp|ssn|account/i.test(k);
      if (flags) flags.push(`RSA-${n * 8}-sized "${k}"`);
      sight(`rsa-blob-${secret}`, {
        cat: 'network', sev: secret ? 'high' : 'medium',
        title: secret ? 'Secret field encrypted with RSA in the browser before sending' : 'RSA-sized ciphertext / signature sent to the server',
        plain: secret ? 'Passwords or secrets are RSA-encrypted before sending — they could be recorded now and cracked later.'
          : 'Data is RSA-encrypted (or RSA-signed) before sending — it could be recorded now and cracked later.',
        detail: `A value of exactly ${n} bytes is what RSA-${n * 8} produces. ${secret ? 'Typical of login forms that RSA-encrypt the password (JSEncrypt / forge) on top of TLS — ' : ''}once RSA and the classical TLS key exchange fall, recorded traffic gives the plaintext.`,
        why: WHY.hndl, fix: 'Rely on PQ-hybrid TLS, or replace the RSA layer with ML-KEM-768 + AES-GCM (or OPAQUE for passwords).',
        assets: [{ name: `RSA-${n * 8}`, primitive: 'pke' }],
      }, `${where} · field "${k}"`);
    }
  }

  function analyzeText(text, where, { flags = null, body = false } = {}) {
    if (!text || typeof text !== 'string') return;
    if (text.length > MAX_BODY_SCAN * 2) text = text.slice(0, MAX_BODY_SCAN * 2);
    if (text.includes('eyJ')) for (const m of text.matchAll(JWT_RE)) tokenSeen(m[0], where, flags);
    if (text.includes('-----BEGIN')) for (const m of text.matchAll(PEM_RE)) pemSeen(m[1], m[0], where, flags);
    if (text.includes('"kty"')) for (const m of text.matchAll(JWK_RE)) { try { jwkSeen(JSON.parse(m[0]), where, flags); } catch (_) {} }
    if (body) bodySniff(text, where, flags);
  }

  // Script source: algorithm names, embedded keys, library fingerprints.
  function scanCodeText(text, label) {
    for (const p of CODE_PATTERNS) {
      if (!p.re.test(text)) continue;
      sight(`code-${p.id}`, {
        cat: 'code', sev: p.sev, title: `Scripts reference ${p.label}`,
        plain: p.sev === 'pass' ? 'The site\'s code includes post-quantum crypto.' : `The site's code mentions ${p.label} (it may not actually be used).`,
        detail: p.sev === 'pass' ? '' : 'Static match in script source — may be library code that never runs. "Crypto running in the page" shows real calls.',
        why: WHY[p.why], fix: p.sev === 'pass' || p.sev === 'info' ? '' : 'Confirm whether it is used; plan the ML-KEM / ML-DSA replacement.',
        assets: p.id === 'pq' || p.id === 'webauthn' ? [] : [{ name: p.label.split(' ')[0], primitive: p.why === 'hndl' ? 'key-agree' : p.why === 'sha1' ? 'hash' : p.why === 'legacy' ? 'block-cipher' : 'signature' }],
      }, label);
    }
    analyzeText(text, label);
    for (const [name, p] of Object.entries(PKGS)) {
      if (!p.fp) continue;
      const m = text.match(p.fp);
      if (m) pkgSeen(name, m[1], `bundle fingerprint in ${label}`);
    }
    const map = text.slice(-2000).match(/[#@] sourceMappingURL=(\S+)\s*$/);
    return map ? map[1] : null;
  }

  function scanWasm(bytes, label) {
    if (!bytes || bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return;
    let fp = bytes.length;
    for (let i = 0; i < bytes.length; i += Math.max(1, bytes.length >> 10)) fp = (fp * 31 + bytes[i]) >>> 0;
    if (obs.wasmSeen.has(fp)) return;             // same module seen by the runtime hook and the deep fetch
    obs.wasmSeen.add(fp);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    for (const g of WASM_SIGS) {
      if (!g.re.test(s)) continue;
      sight(`wasm-${g.id}`, {
        cat: 'code', sev: g.sev, title: `WebAssembly module contains ${g.label}`,
        plain: g.sev === 'pass' ? 'A compiled (WebAssembly) module includes post-quantum crypto.' : `A compiled (WebAssembly) module contains ${g.label}.`,
        detail: g.sev === 'pass' ? '' : 'Symbols compiled into a WASM binary — crypto that never shows up in JavaScript or WebCrypto.',
        why: WHY[g.why], fix: g.sev === 'pass' || g.sev === 'info' ? '' : g.why === 'hndl' ? FIX.hndl : FIX.forge,
        assets: g.id === 'tlslib' || g.id === 'pq' ? [] : [{ name: g.label, primitive: g.why === 'hndl' ? 'key-agree' : 'signature' }],
      }, `${label} (${(bytes.length / 1024 | 0)} KB)`);
    }
    analyzeText(s.replace(/[^\x20-\x7e\n]+/g, ' '), label);
  }

  const WEBPUSH_DEF = {
    cat: 'network', sev: 'medium', title: 'Web Push subscription (messages encrypted with ECDH P-256)',
    plain: 'Push notifications are encrypted in a way a quantum computer could break later.',
    detail: 'RFC 8291 push payloads are keyed with ECDH on P-256 and travel through the browser vendor\'s push service — recordable, so their contents are harvest-now-decrypt-later.',
    why: WHY.hndl, fix: 'Keep sensitive content out of push payloads (send a "fetch new data" ping instead).',
    assets: [{ name: 'ECDH P-256', primitive: 'key-agree' }],
  };

  // ── 6. Runtime hooks (installed before the page runs) ─────────────────────
  // Replace obj[name] with a spy: before(args, this) → ctx, then the original,
  // then after(result, args, ctx, this). exportFunction is Firefox's way of
  // handing a function to the page.
  function spy(obj, name, before, after) {
    try {
      if (!obj || typeof obj[name] !== 'function') return;
      const orig = obj[name];
      const wrapped = function (...args) {
        let ctx;
        if (before) try { ctx = before(args, this); } catch (_) {}
        const res = orig.apply(this, args);
        if (after) try { after(res, args, ctx, this); } catch (_) {}
        return res;
      };
      if (typeof exportFunction === 'function') exportFunction(wrapped, obj, { defineAs: name });
      else Object.defineProperty(obj, name, { value: wrapped, writable: true, configurable: true });
    } catch (_) {}
  }

  // Constructors go through a Proxy so `instanceof` and statics keep working.
  // Skipped on Firefox, where a Proxy across the sandbox boundary misbehaves.
  function spyCtor(name, before, after) {
    if (typeof exportFunction === 'function') return;
    try {
      const C = W[name];
      if (typeof C !== 'function') return;
      W[name] = new Proxy(C, {
        construct(t, args, nt) {
          try { before && before(args); } catch (_) {}
          const inst = Reflect.construct(t, args, nt);
          try { after && after(inst, args); } catch (_) {}
          return inst;
        },
      });
    } catch (_) {}
  }

  function wcAlg(alg, key) {
    const a = typeof alg === 'string' ? { name: alg } : (alg || {});
    const k = (key && key.algorithm) || {};
    const name = String(a.name || k.name || '?').toUpperCase();
    const curve = a.namedCurve || k.namedCurve;
    const bits = a.modulusLength || k.modulusLength || a.length || k.length;
    return { name, param: curve || (bits ? String(bits) : '') };
  }
  function recordWc(op, alg, key) {
    const { name, param } = wcAlg(alg, key);
    remember(obs.crypto, `${op}|${name}|${param}`, { op, alg: name, param }, callerSite());
    scheduleQuick();
  }

  function hdrEntries(h) {
    try {
      if (!h) return [];
      if (Array.isArray(h)) return h;
      if (typeof h.forEach === 'function') { const out = []; h.forEach((v, k) => out.push([k, v])); return out; }
      return Object.entries(h);
    } catch (_) { return []; }
  }
  function bodyText(b) {
    if (b == null) return '';
    if (typeof b === 'string') return b;
    const t = tagOf(b);
    if (t === '[object URLSearchParams]') return b.toString();
    if (t === '[object FormData]') {
      const parts = [];
      b.forEach((v, k) => { if (typeof v === 'string') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`); });
      return parts.join('&');
    }
    return '';
  }

  const netCtx = e => `${e.method} ${shortUrl(e.url)}`;
  function netStart(kind, method, rawUrl) {
    const url = abs(rawUrl);
    const e = { kind, method: String(method || 'GET').toUpperCase(), url: redact(url).slice(0, 500), status: '', flags: [] };
    obs.net.push(e);
    if (obs.net.length > MAX_NET_LOG) obs.net.shift();
    if (/^http:/i.test(url) && location.protocol === 'https:') {
      e.flags.push('plain HTTP');
      sight('net-http', { cat: 'transport', sev: 'high', title: 'Requests sent over plain HTTP from an HTTPS page', plain: 'Some requests are sent without any encryption.',
        detail: 'Readable by anyone on the path today (browsers block some of these as mixed content).', why: WHY.leak, fix: 'Use https:// endpoints.' }, netCtx(e));
    }
    analyzeText(url, `${netCtx(e)} · URL`, { flags: e.flags });
    scheduleQuick();
    return e;
  }

  function inspectHeaders(entries, e) {
    for (const [k, v] of entries) {
      const key = String(k).toLowerCase(), val = String(v);
      if (/authorization|dpop|token|auth|session|jwt/.test(key)) analyzeText(val, `${netCtx(e)} · header ${key}`, { flags: e.flags });
      if (key === 'signature-input' || key === 'signature') {
        const alg = (val.match(/alg(?:orithm)?="([^"]+)"/) || [])[1];
        if (!alg) continue;
        e.flags.push(`HTTP signature ${alg}`);
        const pq = isPqName(alg), sym = /hmac/i.test(alg);
        sight(`httpsig-${alg}`, { cat: 'network', sev: pq || sym ? 'pass' : 'low', title: `HTTP message signatures with ${alg}`,
          plain: pq || sym ? 'Requests are signed in a quantum-safe way.' : `Requests are signed with ${alg} — a quantum computer could fake these signatures.`,
          why: pq ? WHY.pq : sym ? WHY.grover : WHY.forge, fix: pq || sym ? '' : FIX.forge,
          assets: [{ name: alg, primitive: sym ? 'mac' : 'signature' }] }, netCtx(e));
      }
    }
  }

  const SCAN_CT = /json|jose|jwt|text\/plain|pem|pkix|x509|pgp|form-urlencoded/i;
  function inspectResponse(r, e) {
    e.status = r.status;
    const ct = r.headers.get('content-type') || '';
    inspectHeaders(hdrEntries(r.headers), e);
    if (r.type === 'opaque' || !SCAN_CT.test(ct) || +(r.headers.get('content-length') || 0) > MAX_BODY_SCAN) return;
    r.clone().text().then(t => { analyzeText(t.slice(0, MAX_BODY_SCAN), `${netCtx(e)} · response`, { flags: e.flags }); }).catch(() => {});
  }

  let inConsole = false;
  const CONSOLE_CRYPTO = /\b(?:RSA|ECDSA|ECDHE?|secp256k1|X25519|Ed25519|P-256|RS256|ES256|PS256|SubtleCrypto|CryptoKey|OperationError|importKey|deriveKey|unwrapKey|ML-KEM|ML-DSA|Kyber|Dilithium|certificate|handshake|cipher|decrypt(?:ion)?|encrypt(?:ion)?)\b/i;
  function onConsole(level, args) {
    if (inConsole || !settings.console) return;
    inConsole = true;
    try {
      const text = Array.from(args, a => brief(a)).join(' ').slice(0, 20000);
      const where = `console.${level}`;
      const flags = [];
      analyzeText(text, where, { flags });
      const keyMatch = text.match(/CryptoKey\{(\w+) ([\w-]+)(?: ([\w-]+))?\}/);
      if (keyMatch) {
        const kind = (WEBCRYPTO[keyMatch[2].toUpperCase()] || {}).kind;
        flags.push(`CryptoKey ${keyMatch[2]}`);
        sight(`console-key-${keyMatch[2]}`, { cat: 'console', sev: keyMatch[1] === 'private' ? 'low' : 'info', title: `CryptoKey logged to console: ${keyMatch[1]} ${keyMatch[2]}${keyMatch[3] ? ' ' + keyMatch[3] : ''}`,
          plain: 'The site prints its crypto keys to the browser console.',
          detail: 'Shows which algorithms the app keeps keys for.', why: kind ? (kind === 'sig' ? WHY.forge : WHY.hndl) : '',
          assets: kind ? [{ name: `${keyMatch[2]}${keyMatch[3] ? ' ' + keyMatch[3] : ''}`, primitive: PRIMITIVE[kind] }] : [] }, `${where} ← ${callerSite() || '?'}`);
      }
      const crypto = CONSOLE_CRYPTO.test(text);
      if (!flags.length && !crypto) return;
      if (crypto && !flags.length) sight('console-crypto', { cat: 'console', sev: 'info', title: 'Crypto-related messages in the console',
        detail: 'Errors and logs mentioning keys, algorithms or TLS — see the Console tab.' }, `${where}: ${redact(text).slice(0, 120)}`);
      obs.console.push({ level, text: redact(text).slice(0, 400), flags, where: callerSite() });
      if (obs.console.length > MAX_CONSOLE_LOG) obs.console.shift();
    } catch (_) {
    } finally { inConsole = false; }
  }

  function wasmBytes(src, how) {
    const t = tagOf(src);
    let bytes = null;
    if (t === '[object ArrayBuffer]') bytes = new Uint8Array(src);
    else if (ArrayBuffer.isView(src)) bytes = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    if (!bytes || bytes.length > MAX_WASM_BYTES) return;
    const copy = bytes.slice();
    const site = callerSite();
    setTimeout(() => scanWasm(copy, `${how}${site ? ' ← ' + site : ''}`), 0);
  }

  (function installHooks() {
    const SC = W.SubtleCrypto && W.SubtleCrypto.prototype;
    spy(SC, 'generateKey', a => recordWc('generateKey', a[0]));
    spy(SC, 'importKey',   a => recordWc('importKey', a[2]));
    spy(SC, 'exportKey',   a => recordWc(a[1] && a[1].type === 'private' ? 'exportKey(private)' : 'exportKey', null, a[1]));
    spy(SC, 'encrypt',     a => recordWc('encrypt', a[0], a[1]));
    spy(SC, 'decrypt',     a => recordWc('decrypt', a[0], a[1]));
    spy(SC, 'sign',        a => recordWc('sign', a[0], a[1]));
    spy(SC, 'verify',      a => recordWc('verify', a[0], a[1]));
    spy(SC, 'digest',      a => recordWc('digest', a[0]));
    spy(SC, 'deriveKey',   a => recordWc('deriveKey', a[0], a[1]));
    spy(SC, 'deriveBits',  a => recordWc('deriveBits', a[0], a[1]));
    spy(SC, 'wrapKey',     a => recordWc('wrapKey', a[3], a[2]));
    spy(SC, 'unwrapKey',   a => recordWc('unwrapKey', a[3], a[2]));
    spy(SC, 'encapsulateKey',  a => recordWc('encapsulate', a[0], a[1]));   // WebCrypto "modern algorithms" draft
    spy(SC, 'encapsulateBits', a => recordWc('encapsulate', a[0], a[1]));
    spy(SC, 'decapsulateKey',  a => recordWc('decapsulate', a[0], a[1]));
    spy(SC, 'decapsulateBits', a => recordWc('decapsulate', a[0], a[1]));

    const CC = W.CredentialsContainer && W.CredentialsContainer.prototype;
    spy(CC, 'create', a => {
      const pk = a[0] && a[0].publicKey;
      if (!pk) return null;
      const rec = { op: 'create', algs: Array.from(pk.pubKeyCredParams || [], p => p && p.alg), rp: pk.rp && (pk.rp.id || pk.rp.name), where: callerSite() };
      obs.webauthn.push(rec);
      scheduleQuick();
      return rec;
    }, (res, a, rec) => {
      if (!rec) return;
      Promise.resolve(res).then(cred => {   // the algorithm the authenticator actually chose
        const alg = cred && cred.response && typeof cred.response.getPublicKeyAlgorithm === 'function' ? cred.response.getPublicKeyAlgorithm() : null;
        if (alg != null) { rec.chosen = alg; scheduleQuick(); }
      }).catch(() => {});
    });
    spy(CC, 'get', a => {
      const pk = a[0] && a[0].publicKey;
      if (pk) { obs.webauthn.push({ op: 'get', algs: [], rp: pk.rpId, where: callerSite() }); scheduleQuick(); }
    });

    spy(W.PushManager && W.PushManager.prototype, 'subscribe', () => sight('webpush-sub', WEBPUSH_DEF, `PushManager.subscribe ← ${callerSite() || '?'}`));
    spy(W.RTCPeerConnection, 'generateCertificate', a => recordWc('rtcCertificate', a[0]));

    if (settings.network) {
      spy(W, 'fetch', a => {
        const [input, init] = a;
        const isReq = input && typeof input === 'object' && typeof input.clone === 'function' && 'url' in input;
        const method = (init && init.method) || (isReq && input.method) || 'GET';
        const e = netStart('fetch', method, isReq ? input.url : input);
        inspectHeaders(hdrEntries((init && init.headers) || (isReq && input.headers)), e);
        const bt = bodyText(init && init.body);
        if (bt) analyzeText(bt.slice(0, MAX_BODY_SCAN), `${netCtx(e)} · request body`, { flags: e.flags, body: true });
        else if (isReq && !/^(GET|HEAD)$/i.test(method)) input.clone().text().then(t => analyzeText(t.slice(0, MAX_BODY_SCAN), `${netCtx(e)} · request body`, { flags: e.flags, body: true })).catch(() => {});
        return e;
      }, (p, a, e) => {
        if (!e || !p || typeof p.then !== 'function') return;
        p.then(r => { try { inspectResponse(r, e); } catch (_) {} scheduleQuick(); }, () => { e.status = 'failed'; });
      });

      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      const xhrMeta = new WeakMap();
      spy(XP, 'open', (a, xhr) => { xhrMeta.set(xhr, { method: a[0], url: String(a[1]), headers: [] }); });
      spy(XP, 'setRequestHeader', (a, xhr) => { const m = xhrMeta.get(xhr); if (m) m.headers.push([a[0], a[1]]); });
      spy(XP, 'send', (a, xhr) => {
        const m = xhrMeta.get(xhr);
        if (!m) return;
        const e = netStart('xhr', m.method, m.url);
        inspectHeaders(m.headers, e);
        const bt = bodyText(a[0]);
        if (bt) analyzeText(bt.slice(0, MAX_BODY_SCAN), `${netCtx(e)} · request body`, { flags: e.flags, body: true });
        xhr.addEventListener('loadend', () => {
          try {
            e.status = xhr.status || 'failed';
            if (!SCAN_CT.test(xhr.getResponseHeader('content-type') || '')) return;
            const rt = xhr.responseType;
            const t = rt === '' || rt === 'text' ? xhr.responseText : rt === 'json' ? JSON.stringify(xhr.response) : '';
            if (t && t.length <= MAX_BODY_SCAN) analyzeText(t, `${netCtx(e)} · response`, { flags: e.flags });
            scheduleQuick();
          } catch (_) {}
        });
      });

      spy(W.Navigator && W.Navigator.prototype, 'sendBeacon', a => {
        const e = netStart('beacon', 'POST', a[0]);
        const bt = bodyText(a[1]);
        if (bt) analyzeText(bt.slice(0, MAX_BODY_SCAN), `beacon ${shortUrl(e.url)}`, { flags: e.flags, body: true });
      });
      spy(W.WebSocket && W.WebSocket.prototype, 'send', function (a, ws) {
        if (typeof a[0] === 'string' && a[0].length <= MAX_BODY_SCAN) analyzeText(a[0], `WebSocket → ${shortUrl(ws.url)}`, { body: true });
      });
      spyCtor('EventSource', a => netStart('eventsource', 'GET', a[0]));
    }

    spyCtor('WebSocket', a => {
      remember(obs.sockets, abs(a[0]), { url: abs(a[0]) }, callerSite());
      if (settings.network) netStart('websocket', 'WS', a[0]);
    }, ws => {
      if (!settings.network) return;
      ws.addEventListener('message', ev => {
        if (typeof ev.data === 'string' && ev.data.length <= MAX_BODY_SCAN) analyzeText(ev.data, `WebSocket ← ${shortUrl(ws.url)}`);
      });
    });
    spyCtor('RTCPeerConnection', () => {
      obs.rtc.count++;
      const w = callerSite();
      if (w && obs.rtc.where.size < 8) obs.rtc.where.add(w);
      scheduleQuick();
    });
    spyCtor('Worker', a => obs.workers.add(abs(a[0])));
    spyCtor('SharedWorker', a => obs.workers.add(abs(a[0])));
    spy(W.ServiceWorkerContainer && W.ServiceWorkerContainer.prototype, 'register', a => obs.workers.add(abs(a[0])));

    const WA = W.WebAssembly;
    spy(WA, 'compile', a => wasmBytes(a[0], 'WebAssembly.compile'));
    spy(WA, 'instantiate', a => wasmBytes(a[0], 'WebAssembly.instantiate'));
    for (const fn of ['compileStreaming', 'instantiateStreaming']) {
      spy(WA, fn, a => { Promise.resolve(a[0]).then(r => { if (r && r.url) obs.wasmUrls.add(r.url); }).catch(() => {}); });
    }

    if (settings.console) {
      for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) spy(W.console, level, a => onConsole(level, a));
    }
    window.addEventListener('error', ev => onConsole('uncaught', [ev.message || '']), true);
    window.addEventListener('unhandledrejection', ev => onConsole('uncaught', [ev.reason]), true);
    window.addEventListener('message', ev => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : brief(ev.data);
        if (text.length <= MAX_BODY_SCAN) analyzeText(text, `postMessage from ${ev.origin || '?'}`);
      } catch (_) {}
    }, true);
  })();

  // ── 7. Network helper (for the deep scan) ─────────────────────────────────
  function parseHeaders(raw) {
    const h = {};
    for (const line of String(raw || '').split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return h;
  }

  // Always anonymous: no cookies go to the probed hosts. blob: URLs go through
  // the page's own fetch (they only exist in this document).
  function gm(url, { timeout = 10000, headers = {}, headersOnly = false, binary = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!HAS_GM_XHR || /^blob:/.test(url)) {
        nativeFetch(url, { headers, credentials: 'omit' })
          .then(async r => resolve({ status: r.status, finalUrl: r.url, headers: Object.fromEntries(r.headers), text: headersOnly || binary ? '' : await r.text(), bytes: binary ? new Uint8Array(await r.arrayBuffer()) : null }))
          .catch(reject);
        return;
      }
      let done = false, req = null;
      const finish = (v, err) => { if (done) return; done = true; err ? reject(err) : resolve(v); };
      req = GM_xmlhttpRequest({
        method: 'GET', url, headers, timeout, anonymous: true, responseType: binary ? 'arraybuffer' : undefined,
        onreadystatechange(r) {
          if (headersOnly && r.readyState >= 2 && r.status) {
            finish({ status: r.status, finalUrl: r.finalUrl, headers: parseHeaders(r.responseHeaders), text: '' });
            try { req && req.abort(); } catch (_) {}
          }
        },
        onload(r) {
          finish({ status: r.status, finalUrl: r.finalUrl, headers: parseHeaders(r.responseHeaders),
            text: binary ? '' : (r.responseText || ''), bytes: binary && r.response ? new Uint8Array(r.response) : null });
        },
        onerror()   { finish(null, new Error('network error')); },
        ontimeout() { finish(null, new Error('timed out')); },
        onabort()   { finish(null, new Error('aborted')); },
      });
    });
  }

  async function gmJson(url, opts) {
    const r = await gm(url, opts);
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(r.text);
  }

  // ── 8. Findings ───────────────────────────────────────────────────────────
  const CATS = {
    transport: 'Transport — TLS & HTTP',
    cert:      'Certificate',
    web:       'Web security basics',
    network:   'Network traffic (fetch / XHR / WebSocket)',
    client:    'Crypto running in the page',
    stored:    'Keys & tokens stored in the browser',
    tokens:    'Tokens & sessions',
    auth:      'Passkeys / WebAuthn',
    libs:      'Crypto libraries & SDKs',
    code:      'Crypto referenced in scripts / WASM',
    keys:      'Published keys',
    console:   'Console',
    dns:       'DNS & email',
    browser:   'Your browser',
  };

  function F(cat, sev, title, o = {}) {
    return { cat, sev, title, plain: o.plain || '', detail: o.detail || '', why: o.why || '', fix: o.fix || '', where: o.where || [], assets: o.assets || [] };
  }

  const deep = { running: false, done: false, step: '', findings: [], time: null };
  let quick = [];

  // ── 8a. Quick checks (never leave the browser) ────────────────────────────
  function pageSensitivity() {
    const tags = [];
    const q = s => { try { return !!document.querySelector(s); } catch (_) { return false; } };
    if (q('input[type=password]')) tags.push('passwords');
    if (q('input[autocomplete^="cc-"], input[name*="card" i][name*="num" i]')) tags.push('payment cards');
    if (q('input[autocomplete="one-time-code"]')) tags.push('one-time codes');
    if (q('input[name*="ssn" i], input[name*="aadhaar" i], input[name*="passport" i], input[name*="national" i]')) tags.push('government IDs');
    if (/\b(health|medical|patient|diagnos|clinic)/i.test(document.title)) tags.push('health data');
    if (obs.webauthn.length) tags.push('credentials');
    return tags;
  }

  function checkProtocol() {
    const out = [];
    if (location.protocol !== 'https:') {
      out.push(F('transport', 'critical', 'Page is served over plain HTTP', { plain: 'This site does not use encryption at all (plain HTTP).', why: WHY.leak,
        detail: 'No encryption at all — anyone on the path can read and change it today, no quantum computer needed.',
        fix: 'Serve over HTTPS with HSTS; then enable hybrid X25519MLKEM768 key exchange.', where: [location.origin],
      }));
      return out;
    }
    const mixed = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.startsWith('http:'));
    if (mixed.length) out.push(F('transport', 'high', `${mixed.length} resource(s) loaded over plain HTTP`, { plain: 'Some files on this page load without encryption.', why: WHY.leak,
      detail: 'Mixed content bypasses TLS entirely.', fix: 'Load every resource over HTTPS (add upgrade-insecure-requests to CSP).', where: mixed,
    }));
    const forms = [...document.forms].map(f => f.action).filter(a => /^http:/i.test(a));
    if (forms.length) out.push(F('transport', 'high', 'Form submits over plain HTTP', { plain: 'A form sends what you type without encryption.', why: WHY.leak, detail: 'Whatever is typed is sent unencrypted.', fix: 'Point form actions at HTTPS.', where: forms }));
    const ws = [...obs.sockets.values()];
    const plainWs = ws.filter(s => /^ws:/i.test(s.url));
    if (plainWs.length) out.push(F('transport', 'high', 'Unencrypted WebSocket (ws://)', { plain: 'A live connection on this page is not encrypted.', why: WHY.leak,
      detail: 'Live data on this socket travels in clear text.', fix: 'Use wss://.', where: plainWs.map(s => `${s.url}  ← ${[...s.where][0] || '?'}`),
    }));
    if (ws.length > plainWs.length) out.push(F('transport', 'info', `${ws.length - plainWs.length} secure WebSocket(s) opened`, {
      detail: 'wss:// rides on TLS — each host has the same PQ question as the page itself (see deep scan).',
      where: ws.filter(s => !/^ws:/i.test(s.url)).map(s => s.url),
    }));
    if (obs.rtc.count) out.push(F('transport', 'medium', `WebRTC connection created (${obs.rtc.count}×)`, {
      plain: 'Calls and live data connections use encryption a quantum computer could break later.',
      detail: 'Calls, screen-share and data channels are keyed with DTLS using classical ECDHE (P-256 / X25519). Browsers have not shipped PQ DTLS yet.',
      why: WHY.hndl, fix: 'Nothing to toggle on the site today; for sensitive data channels add an application-layer hybrid ML-KEM wrap.',
      where: [...obs.rtc.where], assets: [{ name: 'DTLS ECDHE', primitive: 'key-agree' }],
    }));
    const sens = pageSensitivity();
    if (sens.length) out.push(F('transport', 'info', `This page handles ${sens.join(', ')}`, {
      detail: 'Mosca\'s rule: if data must stay secret for X years and migration takes Y years, you are exposed when X + Y exceeds the time until a quantum computer arrives. Such data raises the stakes of classical-only key exchange.',
    }));
    return out;
  }

  let lastStorageScan = 0;
  function scanStorage() {
    if (Date.now() - lastStorageScan < 5000) return;
    lastStorageScan = Date.now();
    try {
      for (const c of document.cookie.split(/;\s*/)) {
        const i = c.indexOf('=');
        if (i <= 0) continue;
        let v = c.slice(i + 1);
        try { v = decodeURIComponent(v); } catch (_) {}
        analyzeText(v, `cookie "${c.slice(0, i)}"`);
      }
    } catch (_) {}
    for (const [name, s] of [['localStorage', W.localStorage], ['sessionStorage', W.sessionStorage]]) {
      try { for (let i = 0; i < s.length; i++) { const k = s.key(i), v = s.getItem(k); analyzeText(v, `${name} "${k}"`); noteSecrets(name, k, v); } } catch (_) {}
    }
    analyzeText(location.href, 'page URL');
  }

  function checkTokens() {
    scanStorage();
    const out = [...liveTokens.values()].map(g => F('tokens', g.sev, g.title, {
      plain: g.plain, why: g.why, fix: g.fix, where: g.where,
      assets: g.alg ? [{ name: g.alg, primitive: g.kind === 'pke' ? 'kem' : g.kind === 'mac' ? 'mac' : 'signature' }] : [],
    }));
    if (!out.length) out.push(F('tokens', 'info', 'No JWTs seen yet', {
      detail: 'Checked cookies, storage, the URL, and every request/response so far. HttpOnly cookies are invisible to scripts; deep scan checks the site\'s OpenID/JWKS keys.',
    }));
    return out;
  }

  function checkWebCrypto() {
    const out = new Map();
    const safe = new Set();
    for (const e of obs.crypto.values()) {
      const info = WEBCRYPTO[e.alg];
      const label = `${e.alg}${e.param ? ' ' + e.param : ''}`;
      let sev, why, title, fix = '', prim, plain;
      if (isPqName(e.alg)) { sev = 'pass'; why = WHY.pq; title = `${e.alg} used via WebCrypto`; prim = 'kem'; plain = `The page uses post-quantum ${e.alg}.`; }
      else if (info && (info.kind === 'pke' || info.kind === 'ka')) {
        sev = 'high'; why = WHY.hndl; fix = FIX.hndl; prim = PRIMITIVE[info.kind];
        title = `${label} used to ${info.kind === 'ka' ? 'agree keys' : 'encrypt'} in the page`;
        plain = `The page encrypts data with ${label} — it could be recorded now and broken later.`;
      } else if (info && info.kind === 'sig') {
        sev = 'medium'; why = WHY.forge; fix = FIX.forge; prim = 'signature';
        title = e.op === 'rtcCertificate' ? `WebRTC certificate generated with ${label}` : `${label} signatures made/checked in the page`;
        plain = e.op === 'rtcCertificate' ? 'Call certificates use signatures a quantum computer could fake.' : `The page signs data with ${label} — a quantum computer could fake these signatures.`;
      } else if (/^SHA-?1$/.test(e.alg)) { sev = 'low'; why = WHY.sha1; fix = 'Use SHA-256 or better.'; prim = 'hash'; title = 'SHA-1 digests computed in the page'; plain = 'The page uses SHA-1, an outdated hash.'; }
      else if (/^AES/.test(e.alg) && e.param === '128') { sev = 'low'; why = WHY.grover; fix = 'Use 256-bit AES keys.'; prim = 'ae'; title = `${e.alg} with a 128-bit key`; plain = 'The page uses 128-bit encryption keys (256-bit is safer).'; }
      else { if (e.alg !== '?') safe.add(label); continue; }
      const f = out.get(title) || F('client', sev, title, { plain, why, fix, where: [], assets: [{ name: label, primitive: prim }] });
      f.where.push(`${e.op} ×${e.count}${e.where.size ? '  ← ' + [...e.where].join(', ') : ''}`);
      out.set(title, f);
    }
    const list = [...out.values()];
    if (safe.size) list.push(F('client', 'pass', `Quantum-safe WebCrypto in use: ${[...safe].join(', ')}`, {
      plain: 'The page\'s own encryption (AES / SHA / HMAC) is quantum-safe.',
      why: WHY.grover, assets: [...safe].map(n => ({ name: n, primitive: /^SHA/.test(n) ? 'hash' : /HMAC/.test(n) ? 'mac' : /KDF/.test(n) ? 'kdf' : 'ae' })),
    }));
    if (!list.length) list.push(F('client', 'info', 'No WebCrypto calls seen yet', {
      detail: 'Calls are recorded live — log in, send a message, or use the site\'s secure features, then look again.',
    }));
    return list;
  }

  function cdnPackage(url) {
    let m = url.match(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|esm\.sh|cdn\.skypack\.dev|esm\.run)\/((?:@[^/@]+\/)?[^/@?]+)(?:@([\w.\-]+))?/i);
    if (m) return [m[1], m[2]];
    m = url.match(/ga\.jspm\.io\/npm:((?:@[^/@]+\/)?[^/@]+)@([\w.\-]+)/i);
    if (m) return [m[1], m[2]];
    m = url.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/]+)/i);
    if (m) return [m[1], m[2]];
    return null;
  }

  function scriptUrls() {
    const set = new Set([...document.scripts].map(s => s.src).filter(Boolean));
    for (const e of performance.getEntriesByType('resource')) {
      if (e.initiatorType === 'script' || /\.m?js(?:[?#]|$)/i.test(e.name)) set.add(e.name);
    }
    obs.workers.forEach(u => set.add(u));
    if (OWN_SRC) set.delete(OWN_SRC);
    return [...set];
  }

  function checkLibraries() {
    for (const url of scriptUrls()) {
      const c = cdnPackage(url);
      if (c) pkgSeen(c[0], c[1], `CDN: ${url}`);
      for (const [name, p] of Object.entries(PKGS)) if (p.src && p.src.test(url)) pkgSeen(name, null, url);
    }
    for (const [name, p] of Object.entries(PKGS)) {
      for (const g of p.globals || []) {
        try { if (W[g] != null && (g !== 'forge' || W.forge.pki) && (g !== 'supabase' || W.supabase.createClient)) pkgSeen(name, null, `window.${g}`); } catch (_) {}
      }
    }
    const out = [];
    for (const [name, rec] of packages) {
      const p = PKGS[name];
      const ver = rec.versions.size ? `@${[...rec.versions].join(', ')}` : '';
      out.push(F('libs', p.sev, `${name}${ver} — ${p.label}`, {
        plain: p.sev === 'pass' ? `Uses ${name}, a post-quantum crypto library.` : p.sev === 'info' ? ''
          : p.why === 'hndl' ? `Uses ${name} for encryption a quantum computer could break later.` : `Uses ${name} for signatures a quantum computer could fake.`,
        why: WHY[p.why], where: [...rec.where],
        fix: p.sev === 'pass' ? '' : p.why === 'grover' ? 'Use 256-bit keys.' : p.why === 'hndl' ? FIX.hndl : p.sev === 'info' ? '' : FIX.forge,
        assets: p.sev === 'info' && p.why !== 'grover' ? [] : [{ name: p.label.replace(/ \(.*$/, ''),
          primitive: p.why === 'hndl' ? (/RSA/.test(p.label) ? 'pke' : 'key-agree') : p.why === 'forge' ? 'signature' : p.why === 'pq' ? 'kem' : 'ae' }],
      }));
    }
    try {
      if (W.ethereum || W.solana || W.phantom) out.push(F('libs', 'info', 'Crypto wallet injected into the page', {
        detail: 'Comes from your browser extension, not the site. Wallet keys (secp256k1 / Ed25519) are exposed to Shor once their public key is on-chain.', why: WHY.forge,
      }));
    } catch (_) {}
    return out;
  }

  const scannedInline = new WeakSet();
  function scanInlineScripts() {
    let budget = 3_000_000;
    [...document.scripts].forEach((s, i) => {
      if (s.src || scannedInline.has(s)) return;
      scannedInline.add(s);
      const t = s.textContent || '';
      if (!t || budget <= 0 || SELF_MARK.test(t)) return;
      budget -= t.length;
      scanCodeText(t, `inline <script> #${i + 1}${s.type && s.type !== 'module' ? ' (' + s.type + ')' : ''}`);
    });
  }


  // ── Web security basics (not quantum, but where the real breaches are) ──

  // Passwords, refresh tokens and API secrets kept in localStorage / sessionStorage.
  const storageSecrets = new Map();   // kind → Set of places (never the value)
  const SECRET_FIELDS = [
    ['password', /^(?:.*[_.-])?(?:password|passwd|pwd|passcode)$/i, 4],
    ['refresh',  /refresh[_-]?token/i, 10],
    ['apikey',   /api[_-]?key|client[_-]?secret|secret[_-]?key|private[_-]?key|access[_-]?key[_-]?secret/i, 10],
  ];
  const SECRET_DEF = {
    password: ['high', 'leak', 'Password stored in browser storage',
      'A password is saved in the browser\'s storage — any script on the site can read it.',
      'Never store passwords client-side; keep only a short-lived session token.'],
    refresh: ['medium', 'hygiene', 'Refresh token stored in localStorage / sessionStorage',
      'A long-lived login token sits in browser storage — if stolen, it keeps working for a long time.',
      'Keep refresh tokens in HttpOnly cookies and rotate them on every use.'],
    apikey: ['medium', 'hygiene', 'API key or secret stored in browser storage',
      'A secret key is saved in the browser where any script can read it.',
      'Keep secrets on the server; give the browser short-lived, narrowly scoped tokens. (Public, publishable keys are fine.)'],
  };
  function noteSecrets(store, key, value) {
    const check = (field, v, place) => {
      for (const [kind, re, min] of SECRET_FIELDS) {
        if (!re.test(field) || typeof v !== 'string' || v.length < min) continue;
        const set = storageSecrets.get(kind) || new Set();
        if (set.size < 10) set.add(place);
        storageSecrets.set(kind, set);
      }
    };
    check(key, value, `${store} "${key}"`);
    if (value && (value[0] === '{' || value[0] === '[')) {
      try { walkJson(JSON.parse(value), (k, v) => check(k, v, `${store} "${key}" → ${k}`)); } catch (_) {}
    }
  }
  function checkStorageSecrets() {
    return [...storageSecrets].map(([kind, places]) => {
      const [sev, why, title, plain, fix] = SECRET_DEF[kind];
      return F('stored', sev, title, { plain, why: WHY[why], fix, where: [...places] });
    });
  }

  // Session cookies: what scripts can read (document.cookie) and, where the
  // Cookie Store API exists (Chromium), their Secure / SameSite / expiry flags.
  let cookieInfo = [], lastCookieRead = 0;
  function refreshCookies() {
    if (Date.now() - lastCookieRead < 10000 || !W.cookieStore) return;
    lastCookieRead = Date.now();
    W.cookieStore.getAll().then(list => { cookieInfo = Array.from(list || []); }).catch(() => {});
  }
  const SESSIONISH = /sess|auth|token|jwt|\bsid\b|login|remember|access|refresh/i;
  function checkCookies() {
    refreshCookies();
    const out = [];
    const readable = [];
    for (const c of document.cookie.split(/;\s*/)) {
      const i = c.indexOf('=');
      if (i <= 0) continue;
      const name = c.slice(0, i), val = c.slice(i + 1);
      if (SESSIONISH.test(name) || /^eyJ/.test(val)) readable.push(name);
    }
    if (readable.length) out.push(F('web', 'medium', `${readable.length} login/session cookie(s) readable by JavaScript (no HttpOnly)`, {
      plain: 'Login cookies can be read by any script on the page — one injected script could steal them.',
      why: WHY.hygiene, fix: 'Mark session cookies HttpOnly, Secure and SameSite=Lax.', where: readable.map(n => `cookie "${n}"`),
    }));
    const sess = cookieInfo.filter(c => SESSIONISH.test(c.name) || /^eyJ/.test(c.value || ''));
    const insecure = location.protocol === 'https:' ? sess.filter(c => !c.secure) : [];
    if (insecure.length) out.push(F('web', 'high', 'Login cookie without the Secure flag', {
      plain: 'A login cookie may also be sent over unencrypted connections.',
      why: WHY.hygiene, fix: 'Add Secure to every session cookie (and HSTS so plain HTTP is never used).', where: insecure.map(c => `cookie "${c.name}"`),
    }));
    const crossSite = sess.filter(c => String(c.sameSite).toLowerCase() === 'none');
    if (crossSite.length) out.push(F('web', 'low', 'Login cookie sent on cross-site requests (SameSite=None)', {
      plain: 'A login cookie is sent along when other websites make requests here.',
      why: WHY.hygiene, fix: 'Use SameSite=Lax (or Strict) unless the cookie truly must work cross-site.', where: crossSite.map(c => `cookie "${c.name}"`),
    }));
    const longLived = sess.filter(c => c.expires && c.expires - Date.now() > 365 * 864e5);
    if (longLived.length) out.push(F('web', 'low', 'Login cookie lasts more than a year', {
      plain: 'A login cookie stays valid for over a year — a stolen copy keeps working.',
      why: WHY.hygiene, fix: 'Shorten session lifetime; re-authenticate or rotate long-lived "remember me" tokens.',
      where: longLived.map(c => `cookie "${c.name}" until ${new Date(c.expires).toISOString().slice(0, 10)}`),
    }));
    return out;
  }

  // Third-party scripts / stylesheets without Subresource Integrity.
  // CAPTCHA widgets are left out: their providers change the files without
  // notice (no fixed version to pin a hash to) and self-hosting breaks them,
  // so they are only mentioned, not counted as a weak spot.
  const CAPTCHA_SRC = /(?:google\.com|recaptcha\.net|gstatic\.com)\/recaptcha\/|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|geetest\.com|friendlycaptcha\.(?:com|eu)|mtcaptcha\.com|captcha\.awswaf\.com|captcha-delivery\.com|yandex\.(?:ru|com)\/(?:smart-)?captcha|smartcaptcha\.yandexcloud\.net|captcha\.px-cdn\.net|perimeterx\.net/i;
  function checkSri() {
    const els = [...document.querySelectorAll('script[src], link[rel~="stylesheet"][href], link[rel="modulepreload"][href]')];
    const third = els.filter(e => { try { return new URL(e.src || e.href, location.href).origin !== location.origin; } catch (_) { return false; } });
    const captcha = third.filter(e => CAPTCHA_SRC.test(e.src || e.href));
    const checked = third.filter(e => !captcha.includes(e));
    const missing = checked.filter(e => !e.integrity).map(e => e.src || e.href);
    const out = [];
    if (missing.length) out.push(F('web', 'low', `${missing.length} third-party script/style file(s) without an integrity check (SRI)`, {
      plain: 'Some code is loaded from other servers without a fingerprint check — if one of those servers is hacked, this site runs whatever it serves.',
      why: WHY.hygiene, fix: 'Add integrity="sha384-…" crossorigin="anonymous" to fixed-version CDN files, or self-host them.', where: missing,
    }));
    if (checked.length && !missing.length) out.push(F('web', 'pass', `All ${checked.length} third-party script/style file(s) are integrity-checked`, {
      plain: 'Code loaded from other servers is fingerprint-checked (SRI).',
    }));
    if (captcha.length) out.push(F('web', 'info', `${captcha.length} CAPTCHA file(s) loaded from the provider — skipped in the SRI check`, {
      plain: 'The CAPTCHA is loaded from its provider\'s servers. It can\'t be fingerprint-checked because the provider updates it without notice, and hosting a copy yourself would break it and miss its security fixes — so this is expected, not a weak spot.',
      detail: 'The site trusts the CAPTCHA provider to run code on this page. Keep the page\'s CSP limited to that provider\'s domains.',
      where: captcha.map(e => e.src || e.href),
    }));
    return out;
  }

  function checkWebAuthn() {
    const out = [];
    for (const w of obs.webauthn.slice(-6)) {
      if (w.op === 'create') {
        const names = w.algs.map(a => COSE[a] || a);
        const chosen = w.chosen != null ? (COSE[w.chosen] || w.chosen) : null;
        const pq = names.filter(isPqName);
        const ok = chosen ? isPqName(chosen) : pq.length > 0;
        out.push(F('auth', ok ? 'pass' : 'medium', chosen ? `Passkey registered with ${chosen}` : pq.length ? `Passkey registration offers ${pq.join(', ')}` : `Passkey registration accepts only ${names.join(', ') || '?'}`, {
          plain: ok ? 'Passkeys here use post-quantum signatures.' : 'Passkeys here use signatures a quantum computer could fake.',
          detail: `Offered: ${names.join(', ') || '?'}${chosen ? ` · authenticator chose ${chosen}` : ''}. Passkeys live for years; ES256 (ECDSA P-256) and RS256 are breakable by Shor, so a leaked credential database could become forgeable logins.`,
          why: WHY.forge, fix: ok ? '' : 'Add ML-DSA (COSE -48/-49/-50) to pubKeyCredParams ahead of ES256 as authenticators gain support; keep a re-enrolment path.',
          where: [`rp ${w.rp || '?'}  ← ${w.where || '?'}`],
          assets: (chosen ? [chosen] : names).map(n => ({ name: String(n), primitive: 'signature' })),
        }));
      } else {
        out.push(F('auth', 'info', 'Passkey / security-key sign-in used', {
          detail: 'The credential is most likely ES256 (ECDSA P-256) — the site chose it at registration.', why: WHY.forge, where: [`rp ${w.rp || '?'}`],
        }));
      }
    }
    return out;
  }

  let pageTextCache = { t: 0, out: [] };
  function checkPublishedKeys() {
    if (Date.now() - pageTextCache.t < 15000) return pageTextCache.out;
    const text = (document.body && document.body.innerText || '').slice(0, 2_000_000);
    const out = [];
    const ssh = [...new Set([...text.matchAll(/\b(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-dss) AAAA[0-9A-Za-z+/]{20}/g)].map(m => m[1]))];
    if (ssh.length) out.push(F('keys', 'low', `SSH public keys shown on the page (${ssh.join(', ')})`, {
      plain: 'SSH keys shown on this page could be cracked by a quantum computer.',
      detail: 'Fine to publish classically; a quantum attacker can turn them into private keys. OpenSSH 10 defaults to mlkem768x25519 for key exchange, but host/user keys are still RSA/ECC.',
      why: WHY.forge, where: ssh, assets: ssh.map(n => ({ name: n, primitive: 'signature' })),
    }));
    if (text.includes('-----BEGIN')) for (const m of text.matchAll(PEM_RE)) pemSeen(m[1], m[0], 'page text');
    pageTextCache = { t: Date.now(), out };
    return out;
  }

  function checkSightings() {
    return [...sightings.values()].map(s => F(s.cat, s.sev, s.count > 1 ? `${s.title} (×${s.count})` : s.title,
      { plain: s.plain, detail: s.detail, why: s.why, fix: s.fix, where: [...s.where], assets: s.assets }));
  }

  function checkNetworkSummary() {
    if (!obs.net.length) return [];
    const flagged = obs.net.filter(e => e.flags.length).length;
    return [F('network', 'info', `${obs.net.length} requests watched, ${flagged} with crypto findings`, {
      detail: 'See the Network tab for each request and what was found in its headers and bodies.',
    })];
  }

  function checkBrowser() {
    const ua = navigator.userAgent;
    const chrome = ua.match(/Chrom(?:e|ium)\/(\d+)/), ff = ua.match(/Firefox\/(\d+)/), safari = !chrome && ua.match(/Version\/(\d+).*Safari/);
    let ok = null, name = 'this browser';
    if (chrome) { name = `Chromium ${chrome[1]}`; ok = +chrome[1] >= 131; }
    else if (ff) { name = `Firefox ${ff[1]}`; ok = +ff[1] >= 132; }
    else if (safari) { name = `Safari ${safari[1]}`; ok = +safari[1] >= 26; }
    if (ok === null) return [F('browser', 'info', 'Could not tell whether your browser offers hybrid PQ TLS')];
    return [F('browser', ok ? 'pass' : 'medium', ok ? `${name} offers X25519MLKEM768 in TLS` : `${name} does not offer hybrid PQ TLS`, {
      plain: ok ? 'Your browser supports quantum-safe connections.' : 'Your browser is too old for quantum-safe connections — update it.',
      detail: ok ? 'Your side is ready — PQ protection then depends only on each server.' : 'Update the browser: Chrome 131+, Firefox 132+, Safari 26+ negotiate ML-KEM.',
    })];
  }

  let quickTimer = null, inQuick = false;
  function runQuick() {
    clearTimeout(quickTimer);
    quickTimer = null;
    inQuick = true;
    const all = [];
    for (const fn of [checkProtocol, scanInlineScripts, checkTokens, checkWebCrypto, checkLibraries, checkWebAuthn, checkPublishedKeys, checkStorageSecrets, checkCookies, checkSri, checkNetworkSummary, checkSightings, checkBrowser]) {
      try { all.push(...(fn() || [])); } catch (e) { LOG(fn.name, 'failed', e); }
    }
    inQuick = false;
    quick = all;
    render();
  }
  function scheduleQuick() {
    if (quickTimer || inQuick || !ui.host) return;
    quickTimer = setTimeout(runQuick, ui.open ? 800 : 3000);
  }

  // ── 8b. Deep checks (network) ─────────────────────────────────────────────
  function inferEdge(h) {
    const server = h.server || '';
    if (h['cf-ray'] || /cloudflare/i.test(server)) return { edge: 'Cloudflare', pq: 'likely' };
    if (/^(gws|esf|sffe|gse|google frontend|ghs|gfe|scaffolding)/i.test(server) || h['x-goog-hash'] || h['x-guploader-uploadid']) return { edge: 'Google', pq: 'likely' };
    if (h['x-amz-cf-id']) return { edge: 'Amazon CloudFront', pq: 'unknown' };
    if (h['x-fastly-request-id'] || /\bcache-\w+-\w+/.test(h['x-served-by'] || '')) return { edge: 'Fastly', pq: 'unknown' };
    if (/akamai/i.test(server) || h['x-akamai-transformed']) return { edge: 'Akamai', pq: 'unknown' };
    if (h['x-vercel-id']) return { edge: 'Vercel', pq: 'unknown' };
    if (h['x-nf-request-id']) return { edge: 'Netlify', pq: 'unknown' };
    if (h['x-azure-ref'] || /microsoft-iis/i.test(server)) return { edge: 'Microsoft', pq: 'unknown' };
    if (/github\.com/i.test(server)) return { edge: 'GitHub', pq: 'unknown' };
    return { edge: server || 'unknown server', pq: 'unknown' };
  }

  async function radar(host) {
    const j = await gmJson(`https://api.cloudflare.com/client/v4/radar/post_quantum/tls/support?host=${encodeURIComponent(host)}`, {
      timeout: 20000, headers: { Authorization: `Bearer ${settings.radar}` },
    });
    if (!j.success || !j.result) throw new Error('Radar: ' + JSON.stringify(j.errors || j).slice(0, 120));
    return j.result;
  }

  function thirdPartyOrigins() {
    const set = new Set();
    for (const e of performance.getEntriesByType('resource')) {
      try { const u = new URL(e.name); if (u.protocol === 'https:' && u.origin !== location.origin) set.add(u.origin); } catch (_) {}
    }
    for (const e of obs.net) {
      try { const u = new URL(e.url); if (/^(https|wss):$/.test(u.protocol) && u.host !== location.host) set.add(`https://${u.host}`); } catch (_) {}
    }
    return [...set];
  }

  async function deepTls(out) {
    const origins = [location.origin, ...thirdPartyOrigins().slice(0, MAX_THIRD_PARTY)];
    const results = await Promise.all(origins.map(async origin => {
      const host = new URL(origin).host;
      const r = { origin, host };
      try { Object.assign(r, inferEdge((await gm(origin + '/', { headersOnly: true, timeout: 8000 })).headers)); }
      catch (e) { r.edge = 'unreachable'; r.pq = 'unknown'; }
      if (settings.radar) {
        try { const x = await radar(host); r.pq = x.pq ? 'yes' : 'no'; r.kex = x.kexName; }
        catch (e) { r.radarError = e.message; }
      }
      return r;
    }));
    const [main, ...third] = results;
    const sens = pageSensitivity();
    const kexLine = r => `${r.host} — ${r.edge}${r.kex ? ' · kex ' + r.kex : ''}${r.radarError ? ' · Radar: ' + r.radarError : ''}`;
    const verify = 'Confirm in DevTools → Security (Chrome) or padlock → Connection details (Firefox): look for X25519MLKEM768.';
    const pqAsset = [{ name: 'X25519MLKEM768', primitive: 'kem', nist: 3 }];
    if (location.protocol !== 'https:') { /* plain HTTP: no TLS to judge — already reported as broken */ }
    else if (main.pq === 'yes') out.push(F('transport', 'pass', `${main.host} negotiates hybrid PQ key exchange`, { plain: 'The connection to this site is protected against quantum attacks.', detail: 'Confirmed by Cloudflare Radar.', why: WHY.pq, where: [kexLine(main)], assets: pqAsset }));
    else if (main.pq === 'likely') out.push(F('transport', 'pass', `${main.host} is served by ${main.edge}, which enables X25519MLKEM768 by default`, { plain: `The connection is very likely quantum-safe (${main.edge} turns it on by default).`, detail: verify, why: WHY.pq, where: [kexLine(main)], assets: pqAsset }));
    else out.push(F('transport', main.pq === 'no' || sens.length ? 'high' : 'medium',
      main.pq === 'no' ? `${main.host} does NOT negotiate post-quantum key exchange` : `${main.host}: post-quantum key exchange not confirmed`, {
        plain: main.pq === 'no' ? 'The connection to this site can be recorded now and decrypted later by a quantum computer.'
          : 'Could not confirm the connection to this site is quantum-safe — it probably is not.',
        detail: (main.pq === 'no' ? 'Cloudflare Radar handshake test: classical key exchange only. ' : `Served by ${main.edge}. ${settings.radar ? '' : 'Set a Cloudflare Radar token (menu) for a real handshake test. '}${verify} `) +
          (sens.length ? `This page handles ${sens.join(', ')} — recorded sessions expose them later.` : ''),
        why: WHY.hndl, where: [kexLine(main)],
        fix: 'Enable the X25519MLKEM768 group: OpenSSL 3.5+, BoringSSL, Go 1.24+, nginx/Caddy built on those, or put a PQ-enabled CDN in front. Keep X25519 as fallback.',
        assets: [{ name: 'ECDHE (classical TLS)', primitive: 'key-agree' }],
      }));

    const bad = third.filter(r => r.pq === 'no'), unk = third.filter(r => r.pq === 'unknown'), good = third.filter(r => r.pq === 'yes' || r.pq === 'likely');
    if (bad.length) out.push(F('transport', 'medium', `${bad.length} third-party origin(s) without PQ key exchange`, { plain: `${bad.length} other service(s) this page uses are not quantum-safe.`, why: WHY.hndl, where: bad.map(kexLine), fix: 'Self-host the assets or ask the vendor about ML-KEM support.' }));
    if (unk.length) out.push(F('transport', 'low', `${unk.length} third-party origin(s) with unconfirmed PQ key exchange`, { plain: `${unk.length} other service(s) this page uses might not be quantum-safe.`, detail: 'Scripts, APIs and trackers each have their own TLS connection — any of them may carry your users\' data.', why: WHY.hndl, where: unk.map(kexLine) }));
    if (good.length) out.push(F('transport', 'pass', `${good.length} third-party origin(s) PQ-enabled`, { plain: `${good.length} other service(s) this page uses are quantum-safe.`, where: good.map(kexLine) }));
  }

  // localhost, *.local, single-label names and IP addresses have no public DNS / CT records
  const isLocalHost = h => /^(localhost|[^.]+|.*\.(localhost|local|internal|lan|home\.arpa)|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i.test(h);

  async function deepCert(out) {
    if (isLocalHost(location.hostname)) {
      out.push(F('cert', 'info', `${location.hostname} is a local address — certificate, DNS and email checks skipped`));
      return;
    }
    const host = location.hostname;
    let list;
    try { list = await gmJson(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`, { timeout: 25000 }); }
    catch (e) { out.push(F('cert', 'info', `Certificate lookup on crt.sh failed (${e.message})`, { detail: 'crt.sh is often slow for big domains; the padlock shows the certificate too.' })); return; }
    const leaf = (list || []).sort((a, b) => String(b.not_before).localeCompare(String(a.not_before)))[0];
    if (!leaf) { out.push(F('cert', 'info', `No unexpired certificate for ${host} in CT logs`, { detail: 'It may be covered by a wildcard on the parent domain.' })); return; }
    let d;
    try { d = describeCert(pemToDer((await gm(`https://crt.sh/?d=${leaf.id}`, { timeout: 20000 })).text)); }
    catch (e) { out.push(F('cert', 'info', `Could not download certificate ${leaf.id} from crt.sh`)); return; }
    const weak = d.key.fam === 'RSA' && d.key.bits < 2048;
    const sha1 = /sha1|md5/i.test(d.sig);
    out.push(F('cert', d.key.pq ? 'pass' : weak || sha1 ? 'high' : 'low', `Certificate key ${d.key.name}, signed ${d.sig}`, {
      plain: d.key.pq ? 'The site certificate is post-quantum.' : weak || sha1 ? 'The site certificate uses weak, outdated crypto.'
        : 'The site certificate could be faked by a future quantum computer (true for almost every website today).',
      detail: (weak || sha1 ? 'Classically weak already. ' : '') +
        `Issuer: ${leaf.issuer_name}. Valid until ${String(leaf.not_after).slice(0, 10)}. ` +
        'The whole public Web PKI (roots, intermediates, CT) is still RSA/ECDSA — an ecosystem gap, not something this site can fix alone.',
      why: WHY.forge,
      fix: 'Keep certificates short-lived and fully automated (ACME) so a switch to ML-DSA / Merkle Tree Certificates is a config change. Use ECDSA P-256 or RSA-2048+ meanwhile.',
      where: [`crt.sh id ${leaf.id} · ${leaf.common_name || host}`],
      assets: [{ name: d.key.name, primitive: 'signature' }, { name: d.sig, primitive: 'signature' }],
    }));

    // health: expiry and lifetime (CT shows the newest certificate, normally the one served)
    const day = 864e5;
    const ts = v => Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
    const left = Math.floor((ts(leaf.not_after) - Date.now()) / day);
    const life = Math.round((ts(leaf.not_after) - ts(leaf.not_before)) / day);
    const where = [`crt.sh id ${leaf.id} · ${String(leaf.not_before).slice(0, 10)} → ${String(leaf.not_after).slice(0, 10)}`];
    if (left < 30) out.push(F('cert', left < 10 ? 'high' : 'medium', `Certificate expires in ${left} day(s)`, {
      plain: 'The site certificate expires soon — visitors will get security errors if it is not renewed.',
      why: WHY.hygiene, fix: 'Automate renewal (ACME / certbot) and alert at 30 days.', where,
    }));
    if (life > 398) out.push(F('cert', 'low', `Certificate valid for ${life} days`, {
      plain: 'The certificate is valid for longer than browsers accept (over 398 days).',
      why: WHY.hygiene, fix: 'Issue certificates of 90 days or less and automate renewal.', where,
    }));
    if (left >= 30 && life <= 398) out.push(F('cert', 'pass', `Certificate healthy: ${life}-day lifetime, ${left} days left`, {
      plain: 'The certificate is short-lived and not about to expire.', where,
    }));
  }

  async function doh(name, type) {
    return gmJson(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { timeout: 8000 });
  }

  async function findApex(host) {
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const cand = labels.slice(i).join('.');
      try {
        const j = await doh(cand, 'SOA');
        if ((j.Answer || []).some(r => r.type === 6 && r.name.replace(/\.$/, '').toLowerCase() === cand.toLowerCase())) return cand;
      } catch (_) {}
    }
    return labels.slice(-2).join('.');
  }

  async function deepDns(out) {
    if (isLocalHost(location.hostname)) return;
    const apex = await findApex(location.hostname);
    try {
      const j = await doh(apex, 'DNSKEY');
      const algs = [...new Set((j.Answer || []).filter(r => r.type === 48).map(r => +String(r.data).split(/\s+/)[2]))];
      if (!algs.length) out.push(F('dns', 'info', `${apex} has no DNSSEC`, { detail: 'Nothing quantum-specific to fix; DNS answers are simply unauthenticated today.' }));
      else out.push(F('dns', 'low', `DNSSEC on ${apex} signs with ${algs.map(a => DNSSEC_ALG[a] || a).join(', ')}`, {
        plain: 'The domain\'s DNS signatures could be faked by a quantum computer.',
        detail: `Resolver validated: ${j.AD ? 'yes' : 'no'}. No post-quantum DNSSEC algorithm is standardised yet; RSA/ECDSA zone keys become forgeable to a quantum attacker.`,
        why: WHY.forge, fix: 'Prefer algorithm 13 (ECDSA P-256) for now — smallest rollover cost — and watch the IETF PQ-DNSSEC work.',
        where: [apex], assets: algs.map(a => ({ name: DNSSEC_ALG[a] || `DNSSEC alg ${a}`, primitive: 'signature' })),
      }));
    } catch (e) { out.push(F('dns', 'info', `DNSSEC lookup failed (${e.message})`)); }

    const keys = [];
    await Promise.all(DKIM_SELECTORS.map(async sel => {
      try {
        const j = await doh(`${sel}._domainkey.${apex}`, 'TXT');
        for (const r of (j.Answer || []).filter(r => r.type === 16)) {
          const txt = String(r.data).replace(/"\s*"/g, '').replace(/"/g, '');
          if (!/v=DKIM1|p=/i.test(txt)) continue;
          const k = (txt.match(/k=(\w+)/i) || [, 'rsa'])[1].toLowerCase();
          const p = (txt.match(/p=([A-Za-z0-9+/=]+)/) || [])[1];
          if (!p) continue;
          let name = k === 'ed25519' ? 'Ed25519' : k.toUpperCase(), bits = 0;
          if (k === 'rsa') { try { const d = describeSpki(b64ToBytes(p)); name = d.name; bits = d.bits; } catch (_) {} }
          keys.push({ sel, name, bits });
        }
      } catch (_) {}
    }));
    if (keys.length) {
      const weak = keys.filter(k => k.bits && k.bits < 2048);
      out.push(F('dns', weak.length ? 'medium' : 'low', `DKIM email-signing keys: ${[...new Set(keys.map(k => k.name))].join(', ')}`, {
        plain: weak.length ? 'Email signing keys are weak even today, and fakeable by a quantum computer.' : 'Emails from this domain could be forged by a quantum computer.',
        detail: (weak.length ? 'RSA-1024 is weak even classically. ' : '') + 'A quantum attacker could forge mail that passes DKIM for this domain.',
        why: WHY.forge, fix: 'Use RSA-2048+ now, rotate selectors regularly, and keep DMARC strict. PQ DKIM is not standardised yet.',
        where: keys.map(k => `${k.sel}._domainkey.${apex} → ${k.name}`),
        assets: keys.map(k => ({ name: `DKIM ${k.name}`, primitive: 'signature' })),
      }));
    } else {
      out.push(F('dns', 'info', `No DKIM key found under ${DKIM_SELECTORS.length} common selectors`, { detail: 'Mail may use a selector not in the list, or the domain sends no mail.' }));
    }

    // CAA: which certificate authorities may issue for the domain
    try {
      const caa = ((await doh(apex, 'CAA')).Answer || []).filter(r => r.type === 257).map(r => String(r.data));
      const issuers = [...new Set(caa.map(d => (d.match(/issue(?:wild)?\s+"?([^";\s]*)/) || [])[1]).filter(Boolean))];
      if (!caa.length) out.push(F('cert', 'low', `No CAA record on ${apex}`, {
        plain: 'Any certificate authority is allowed to issue certificates for this domain (no CAA record).',
        why: WHY.hygiene, fix: `Publish CAA records naming only the CAs you use, e.g. ${apex}. CAA 0 issue "letsencrypt.org".`, where: [apex],
      }));
      else out.push(F('cert', 'pass', `CAA limits certificate issuers: ${issuers.join(', ') || caa.join('; ')}`, {
        plain: 'Only chosen certificate authorities may issue certificates for this domain (CAA).', where: [apex],
      }));
    } catch (_) {}

    // Email transport & spoofing: DMARC, MTA-STS, TLS-RPT (only if the domain takes mail)
    let mx = [];
    // a null MX ("0 .", RFC 7505) means the domain accepts no mail at all
    try { mx = ((await doh(apex, 'MX')).Answer || []).filter(r => r.type === 15 && !/^0\s+\.$/.test(String(r.data).trim())); } catch (_) {}
    const txt = async name => {
      try { return ((await doh(name, 'TXT')).Answer || []).filter(r => r.type === 16).map(r => String(r.data).replace(/"\s*"/g, '').replace(/"/g, '')); }
      catch (_) { return []; }
    };
    // DMARC matters even for domains that send no mail: it is what stops others spoofing them
    const dmarc = await txt(`_dmarc.${apex}`);
    const rec = dmarc.find(t => /v=DMARC1/i.test(t));
    const policy = rec && (rec.match(/\bp=(\w+)/i) || [])[1];
    if (!rec) out.push(F('dns', 'medium', `No DMARC record for ${apex}`, {
      plain: 'Nothing stops others from sending email that pretends to come from this domain (no DMARC).',
      why: WHY.hygiene, fix: `Publish _dmarc.${apex} TXT "v=DMARC1; p=quarantine; rua=mailto:…", then move to p=reject (p=reject straight away if the domain sends no mail).`, where: [`_dmarc.${apex}`],
    }));
    else if (/^none$/i.test(policy || '')) out.push(F('dns', 'low', 'DMARC policy is p=none (monitor only)', {
      plain: 'Spoofed email pretending to be this domain is reported but not blocked.',
      why: WHY.hygiene, fix: 'Move the DMARC policy to p=quarantine, then p=reject.', where: [`_dmarc.${apex}: ${rec}`],
    }));
    else out.push(F('dns', 'pass', `DMARC enforces p=${policy}`, { plain: 'Email spoofing of this domain is blocked (DMARC).', where: [`_dmarc.${apex}`] }));

    // encrypted delivery only matters for domains that receive mail
    if (mx.length) {
      const [sts, rpt] = await Promise.all([txt(`_mta-sts.${apex}`), txt(`_smtp._tls.${apex}`)]);
      if (!sts.some(t => /v=STSv1/i.test(t))) out.push(F('dns', 'low', `No MTA-STS for ${apex}`, {
        plain: 'Email sent to this domain can be downgraded to unencrypted on the way (no MTA-STS).',
        why: WHY.hygiene, fix: `Publish _mta-sts.${apex} TXT "v=STSv1; id=…" and https://mta-sts.${apex}/.well-known/mta-sts.txt with mode: enforce.`, where: [`_mta-sts.${apex}`],
      }));
      else out.push(F('dns', 'pass', 'MTA-STS published', { plain: 'Mail servers must use encryption when delivering here (MTA-STS).', where: [`_mta-sts.${apex}`] }));
      if (!rpt.some(t => /v=TLSRPTv1/i.test(t))) out.push(F('dns', 'info', `No TLS-RPT for ${apex}`, {
        detail: 'Without _smtp._tls reports, failed or downgraded encrypted mail deliveries go unnoticed.', where: [`_smtp._tls.${apex}`],
      }));
    }

    // Encrypted Client Hello & HTTP/3 (HTTPS DNS record of the host itself)
    try {
      const rr = ((await doh(location.hostname, 'HTTPS')).Answer || []).filter(r => r.type === 65).map(r => String(r.data));
      if (rr.some(d => /\bech=/.test(d))) out.push(F('transport', 'pass', 'Encrypted Client Hello (ECH) advertised', {
        plain: 'Network observers cannot see which site on this server you are visiting (ECH).',
        detail: 'ECH keys are X25519 (HPKE) today, so the hidden site name is itself harvest-now-decrypt-later until ECH gains an ML-KEM option.',
        where: [location.hostname],
      }));
      else out.push(F('transport', 'low', 'No Encrypted Client Hello (ECH)', {
        plain: 'Anyone watching the network can see that you are visiting this site.',
        why: WHY.hygiene, fix: 'Enable ECH (Cloudflare does it automatically; elsewhere publish an HTTPS record with ech= on a server that supports it).',
        where: [location.hostname],
      }));
      if (rr.some(d => /alpn="?[^"\s]*h3/.test(d))) out.push(F('transport', 'info', 'HTTP/3 (QUIC) advertised', {
        detail: 'QUIC carries TLS 1.3 inside — its post-quantum status is the same as the TLS check above.', where: [location.hostname],
      }));
    } catch (_) {}
  }

  // HSTS, CSP and whether plain-HTTP visits are redirected.
  async function deepWebBasics(out) {
    if (location.protocol !== 'https:') return;   // plain-HTTP pages are already reported as broken
    let hs;
    try { hs = (await gm(location.href, { headersOnly: true, timeout: 10000 })).headers; } catch (_) { return; }
    const hsts = hs['strict-transport-security'];
    const days = Math.floor((+((hsts || '').match(/max-age=(\d+)/i) || [])[1] || 0) / 86400);
    if (!hsts) out.push(F('web', 'medium', 'No HSTS header', {
      plain: 'The site does not force secure connections (no HSTS) — a first visit can be downgraded to unencrypted HTTP.',
      why: WHY.hygiene, fix: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains (then consider preload).', where: [location.origin],
    }));
    else if (days < 180) out.push(F('web', 'low', `HSTS max-age is only ${days} day(s)`, {
      plain: 'Browsers are told to use HTTPS here, but only for a short time.',
      why: WHY.hygiene, fix: 'Raise max-age to at least 31536000 (one year).', where: [`${location.origin}: ${hsts}`],
    }));
    else out.push(F('web', 'pass', `HSTS for ${days} days${/includesubdomains/i.test(hsts) ? ', incl. subdomains' : ''}${/preload/i.test(hsts) ? ', preload' : ''}`, {
      plain: 'Browsers are told to always use HTTPS here (HSTS).', where: [location.origin],
    }));
    if (!hs['content-security-policy']) out.push(F('web', 'low', 'No Content-Security-Policy header', {
      plain: 'Nothing limits which scripts the page may run — injected code would run freely.',
      why: WHY.hygiene, fix: 'Add a CSP (script-src \'self\' with nonces); start in report-only mode.', where: [location.origin],
    }));
    try {
      const r = await gm(`http://${location.host}/`, { headersOnly: true, timeout: 8000 });
      if (/^http:/i.test(r.finalUrl || '') && r.status < 400) out.push(F('web', 'high', 'Site also answers on plain HTTP without redirecting', {
        plain: 'The site can also be opened without encryption — it does not send visitors over to HTTPS.',
        why: WHY.leak, fix: 'Redirect every http:// request to https:// (301) and enable HSTS.', where: [`http://${location.host}/`],
      }));
      else if (/^https:/i.test(r.finalUrl || '')) out.push(F('web', 'pass', 'Plain-HTTP visits are redirected to HTTPS', {
        plain: 'Visitors who type the address without https:// are sent to the encrypted site.', where: [`http://${location.host}/ → ${r.finalUrl}`],
      }));
    } catch (_) {}
  }

  // Every JS file the page loaded (incl. lazy chunks and workers), their
  // source maps (→ exact npm packages), and WASM binaries.
  async function deepScripts(out) {
    try {
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      for (const r of regs) {
        const w = r.active || r.waiting || r.installing;
        if (w && w.scriptURL) obs.workers.add(w.scriptURL);
        if (r.pushManager && await r.pushManager.getSubscription().catch(() => null)) sight('webpush-sub', WEBPUSH_DEF, `push subscription on ${r.scope}`);
      }
    } catch (_) {}

    const urls = scriptUrls().filter(u => /^(https?|blob):/.test(u)).slice(0, MAX_SCRIPTS);
    const maps = [];
    let fetched = 0;
    await Promise.all(urls.map(async src => {
      try {
        const r = await gm(src, { timeout: 15000 });
        if (r.status >= 400 || r.text.length > MAX_SCRIPT_BYTES || SELF_MARK.test(r.text)) return;
        fetched++;
        const map = scanCodeText(r.text, src) || r.headers.sourcemap || r.headers['x-sourcemap'];
        if (map) maps.push({ src, map });
      } catch (_) {}
    }));

    let mapped = 0;
    await Promise.all(maps.slice(0, MAX_SOURCEMAPS).map(async ({ src, map }) => {
      try {
        let json;
        if (/^data:/.test(map)) json = JSON.parse(map.includes(';base64,') ? new TextDecoder().decode(b64ToBytes(map.split(',')[1])) : decodeURIComponent(map.split(',')[1]));
        else json = await gmJson(new URL(map, src).href, { timeout: 15000 });
        mapped++;
        for (const s of json.sources || []) {
          const m = String(s).match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
          if (m) pkgSeen(m[1], null, `source map of ${shortUrl(src)}`);
        }
      } catch (_) {}
    }));

    const wasm = new Set(obs.wasmUrls);
    for (const e of performance.getEntriesByType('resource')) if (/\.wasm(?:[?#]|$)/i.test(e.name)) wasm.add(e.name);
    await Promise.all([...wasm].slice(0, MAX_WASM).map(async url => {
      try {
        const r = await gm(url, { timeout: 30000, binary: true });
        if (r.bytes && r.bytes.length <= MAX_WASM_BYTES) scanWasm(r.bytes, url);
      } catch (_) {}
    }));

    out.push(F('code', 'info', `Scanned ${fetched} JS file(s), ${mapped} source map(s), ${obs.wasmSeen.size} WebAssembly module(s)`, {
      detail: `${obs.workers.size} worker / service-worker script(s) included. Lazy chunks that have not loaded yet are not covered — use the site, then scan again.`,
    }));
  }

  async function deepJwks(out) {
    const bases = new Set([location.origin, ...tokenIssuers]);
    const seen = new Set();
    for (const base of bases) {
      let jwksUri = null, sigAlgs = [];
      try {
        const c = await gmJson(`${base}/.well-known/openid-configuration`, { timeout: 8000 });
        jwksUri = c.jwks_uri; sigAlgs = c.id_token_signing_alg_values_supported || [];
      } catch (_) {
        if (base === location.origin) jwksUri = `${base}/.well-known/jwks.json`;
      }
      if (!jwksUri || seen.has(jwksUri)) continue;
      seen.add(jwksUri);
      let keys;
      try { keys = (await gmJson(jwksUri, { timeout: 8000 })).keys || []; } catch (_) { continue; }
      if (!keys.length) continue;
      const uniq = [...new Set(keys.map(k => (describeJwk(k) || { name: k.kty }).name))];
      const pq = uniq.filter(isPqName);
      out.push(F('tokens', pq.length === uniq.length ? 'pass' : 'medium', `Token-signing keys published by ${new URL(jwksUri).host}: ${uniq.join(', ')}`, {
        plain: pq.length === uniq.length ? 'The keys that sign this site\'s logins are post-quantum.' : 'The keys that sign this site\'s logins could be forged by a quantum computer.',
        detail: `Every login / API token this issuer signs relies on these keys.${sigAlgs.length ? ' Advertised ID-token algs: ' + sigAlgs.join(', ') + '.' : ''}`,
        why: WHY.forge, fix: 'Add an ML-DSA key alongside the current one (JWKS can hold both) so clients can migrate without downtime.',
        where: [jwksUri], assets: uniq.map(n => ({ name: n, primitive: 'signature' })),
      }));
    }
  }

  // security.txt (its PGP key / signature) and did:web documents.
  async function deepWellKnown(out) {
    let sec = null, secUrl = '';
    for (const p of ['/.well-known/security.txt', '/security.txt']) {
      try {
        const r = await gm(location.origin + p, { timeout: 8000 });
        if (r.status === 200 && /^(Contact|Expires|Encryption):/im.test(r.text)) { sec = r.text; secUrl = location.origin + p; break; }
      } catch (_) {}
    }
    if (sec) {
      const sig = sec.match(/-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/);
      if (sig) for (const k of pgpPackets(sig[0])) {
        out.push(F('keys', k.pq ? 'pass' : 'low', `security.txt is PGP-signed with ${k.name}`, {
          plain: k.pq ? 'The security contact file has a post-quantum signature.' : 'The security contact file is signed with a key a quantum computer could fake.', why: k.pq ? WHY.pq : WHY.forge, where: [secUrl], assets: [{ name: `PGP ${k.name}`, primitive: 'signature' }] }));
      }
      const encUrls = [...sec.matchAll(/^Encryption:\s*(https?:\/\/\S+)/gim)].map(m => m[1])
        .filter(u => { try { const x = new URL(u); return x.protocol === 'https:' || x.host === location.host; } catch (_) { return false; } }).slice(0, 3);
      for (const u of encUrls) {
        try {
          const t = (await gm(u, { timeout: 10000 })).text;
          const block = t.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/);
          if (!block) continue;
          const ks = pgpPackets(block[0]).filter(k => k.role !== 'signature');
          const encKeys = ks.filter(k => k.enc);
          const pq = encKeys.length && encKeys.every(k => k.pq);
          out.push(F('keys', pq ? 'pass' : 'medium', `Security contact PGP key: ${ks.map(k => `${k.name} (${k.role})`).join(', ')}`, {
            plain: pq ? 'Security reports to this site use post-quantum encryption.' : 'Security reports sent to this site could be decrypted later by a quantum computer.',
            detail: 'Vulnerability reports encrypted to this key today are harvest-now-decrypt-later — exactly the long-lived secrets an attacker would store.',
            why: pq ? WHY.pq : WHY.hndl, fix: pq ? '' : 'Add an ML-KEM-768+X25519 encryption subkey (RFC 9580 v6 keys + draft-ietf-openpgp-pqc; GnuPG 2.5 / Sequoia support it).',
            where: [u], assets: ks.map(k => ({ name: `PGP ${k.name}`, primitive: k.enc ? 'pke' : 'signature' })),
          }));
        } catch (_) {}
      }
      if (!sig && !encUrls.length) out.push(F('keys', 'info', 'security.txt found, no PGP key or signature', { where: [secUrl] }));
    }

    try {
      const did = await gmJson(`${location.origin}/.well-known/did.json`, { timeout: 8000 });
      const names = (did.verificationMethod || []).map(vm => {
        if (vm.publicKeyJwk) return (describeJwk(vm.publicKeyJwk) || { name: vm.type }).name;
        const mb = vm.publicKeyMultibase && MULTIBASE.find(([p]) => vm.publicKeyMultibase.startsWith(p));
        return mb ? mb[1] : String(vm.type || '?').replace(/VerificationKey\d+|Key\d+$/, '');
      });
      if (names.length) out.push(F('keys', names.every(isPqName) ? 'pass' : 'low', `did:web identity keys: ${[...new Set(names)].join(', ')}`, {
        plain: 'This site\'s digital-identity keys could be forged by a quantum computer.',
        detail: 'Credentials and signatures anchored to this DID become forgeable to a quantum attacker.', why: WHY.forge, fix: FIX.forge,
        where: [`${location.origin}/.well-known/did.json`], assets: [...new Set(names)].map(n => ({ name: n, primitive: 'signature' })),
      }));
    } catch (_) {}
  }

  // CryptoKeys, JWKs, PEMs and tokens the site keeps in IndexedDB.
  async function deepIndexedDb(out) {
    const idb = W.indexedDB;
    if (!idb || typeof idb.databases !== 'function') { out.push(F('stored', 'info', 'This browser cannot list IndexedDB databases')); return; }
    const keys = new Map();
    let stores = 0, records = 0;
    const inspect = (v, where, depth = 0, budget = { n: 400 }) => {
      if (v == null || budget.n-- <= 0 || depth > 4) return;
      if (typeof v === 'string') { if (v.length > 30) analyzeText(v.slice(0, MAX_BODY_SCAN), where); return; }
      if (typeof v !== 'object') return;
      if (tagOf(v) === '[object CryptoKey]') {
        const { name, param } = wcAlg(null, v);
        const k = `${v.type}|${name}|${param}`;
        const e = keys.get(k) || { type: v.type, alg: name, param, extractable: v.extractable, where: new Set() };
        if (e.where.size < 8) e.where.add(where);
        keys.set(k, e);
        return;
      }
      if (typeof v.kty === 'string') { jwkSeen(v, where); return; }
      if (ArrayBuffer.isView(v) || tagOf(v) === '[object ArrayBuffer]' || tagOf(v) === '[object Blob]') return;
      for (const key of Object.keys(v).slice(0, 60)) inspect(v[key], where, depth + 1, budget);
    };
    const dbs = (await idb.databases()).filter(d => d.name).slice(0, IDB_MAX_DBS);
    for (const { name } of dbs) {
      const db = await new Promise(res => {
        let r;
        try { r = idb.open(name); } catch (_) { return res(null); }
        r.onsuccess = () => res(r.result);
        r.onerror = r.onblocked = () => res(null);
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };   // never create a database
        setTimeout(() => res(null), 4000);
      });
      if (!db) continue;
      for (const storeName of [...db.objectStoreNames].slice(0, 25)) {
        stores++;
        await new Promise(res => {
          let n = 0, req;
          try { req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor(); } catch (_) { return res(); }
          req.onsuccess = () => {
            const c = req.result;
            if (!c || n++ >= IDB_MAX_RECORDS) return res();
            records++;
            inspect(c.value, `IndexedDB ${name}/${storeName}`);
            c.continue();
          };
          req.onerror = () => res();
          setTimeout(res, 4000);
        });
      }
      db.close();
    }
    for (const k of keys.values()) {
      const kind = (WEBCRYPTO[k.alg] || {}).kind;
      const label = `${k.alg}${k.param ? ' ' + k.param : ''}`;
      const sev = isPqName(k.alg) ? 'pass' : !kind ? 'pass' : k.type === 'public' ? 'low' : kind === 'sig' ? 'medium' : 'high';
      out.push(F('stored', sev, `${k.type} ${label} key stored in IndexedDB${k.extractable ? ' (extractable)' : ''}`, {
        plain: sev === 'high' ? 'The site keeps a long-term encryption key in your browser — messages it protects could be unlocked later.'
          : sev === 'medium' ? 'The site keeps a signing key in your browser that a quantum computer could fake.'
          : sev === 'low' ? `A public ${label} key is stored in your browser.` : '',
        detail: !kind ? 'Symmetric key — fine at 256 bits.' : kind === 'sig'
          ? 'A long-lived signing key: device / session identity that a quantum attacker could impersonate from the public half.'
          : 'A long-lived key-agreement / decryption key — typical of end-to-end encryption. Messages exchanged with it are harvest-now-decrypt-later.',
        why: isPqName(k.alg) ? WHY.pq : !kind ? WHY.grover : kind === 'sig' ? WHY.forge : WHY.hndl,
        fix: !kind || isPqName(k.alg) ? '' : kind === 'sig' ? FIX.forge : 'Add an ML-KEM layer to the key agreement (PQXDH-style hybrid, as Signal and iMessage PQ3 did).',
        where: [...k.where], assets: [{ name: label, primitive: kind ? PRIMITIVE[kind] : 'ae' }],
      }));
    }
    out.push(F('stored', 'info', `Read ${records} record(s) in ${stores} IndexedDB store(s) of ${dbs.length} database(s)`, {
      detail: `Up to ${IDB_MAX_RECORDS} records per store, read-only.`,
    }));
  }

  async function runDeep() {
    if (deep.running) return;
    if (!HAS_GM_XHR) { alert('tinkatuff: deep scan needs GM_xmlhttpRequest (Tampermonkey / Violentmonkey).'); return; }
    deep.running = true;
    deep.findings = [];
    const steps = [
      ['TLS & edge of each origin', deepTls],
      ['certificate (crt.sh)', deepCert],
      ['DNSSEC & DKIM', deepDns],
      ['JS files, source maps & WASM', deepScripts],
      ['OpenID / JWKS keys', deepJwks],
      ['security.txt & did.json', deepWellKnown],
      ['IndexedDB', deepIndexedDb],
      ['security headers & HTTPS redirect', deepWebBasics],
    ];
    const running = new Set(steps.map(s => s[0]));
    deep.step = [...running].join(' · ');
    render();
    await Promise.all(steps.map(async ([name, fn]) => {
      const out = [];
      try { await fn(out); } catch (e) { out.push(F('transport', 'info', `${name}: ${e.message}`)); LOG(name, e); }
      deep.findings.push(...out);
      running.delete(name);
      deep.step = running.size ? `still running: ${[...running].join(' · ')}` : '';
      runQuick();
    }));
    deep.running = false;
    deep.done = true;
    deep.time = new Date();
    runQuick();
  }

  // ── 9. Scoring, inventory & export ────────────────────────────────────────
  function allFindings() {
    return [...quick, ...deep.findings].sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
  }

  function grade(fs) {
    const score = Math.max(0, 100 - fs.reduce((s, f) => s + PENALTY[f.sev], 0));
    const g = fs.some(f => f.sev === 'critical') ? 'F' : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    return { score, grade: g };
  }

  const SYMMETRIC = new Set(['mac', 'hash', 'ae', 'kdf', 'block-cipher']);
  function quantumSafe(a) {
    if (isPqName(a.name)) return true;
    if (/SHA-?1\b|MD5|\b3?DES\b|RC4/i.test(a.name)) return false;
    if (SYMMETRIC.has(a.primitive) || /^(HS\d|A\d+(GCM|KW)|dir)$/.test(a.name)) return !/\b128\b|A128/.test(a.name);
    return false;
  }
  function migrateTo(a) {
    if (quantumSafe(a)) return '—';
    if (/SHA-?1\b|MD5/i.test(a.name)) return 'SHA-256 or better';
    if (/\b3?DES\b|RC4/i.test(a.name)) return 'AES-256-GCM';
    if (SYMMETRIC.has(a.primitive)) return '256-bit keys';
    if (/^(kem|pke|key-agree)$/.test(a.primitive)) return /RSA/i.test(a.name) ? 'ML-KEM-768 (hybrid with X25519)' : 'X25519MLKEM768 / ML-KEM-768';
    if (a.primitive === 'signature') return 'ML-DSA-65 (SLH-DSA for long-lived roots)';
    return 'ML-KEM / ML-DSA';
  }
  function nistStatus(a) {
    if (quantumSafe(a)) return isPqName(a.name) ? 'FIPS 203/204/205' : 'approved';
    const rsa = String(a.name).match(/RSA-?(\d{3,4})/);
    if (rsa && +rsa[1] < 2048) return 'disallowed now (< 112-bit)';
    if (/SHA-?1\b|MD5/i.test(a.name)) return 'disallowed for signatures';
    if (/\b3?DES\b|RC4/i.test(a.name)) return 'disallowed (NIST SP 800-131A)';
    if (SYMMETRIC.has(a.primitive)) return 'AES-128 acceptable, 256 preferred';
    return 'deprecated 2030, disallowed 2035 (NIST IR 8547)';
  }

  function inventory() {
    const m = new Map();
    for (const f of allFindings()) for (const a of f.assets) {
      const e = m.get(a.name) || { name: a.name, primitive: a.primitive || 'other', nist: a.nist, count: 0, sev: f.sev, where: new Set() };
      e.count += Math.max(1, f.where.length);
      f.where.slice(0, 5).forEach(w => e.where.size < 10 && e.where.add(w));
      if (SEV_ORDER.indexOf(f.sev) < SEV_ORDER.indexOf(e.sev)) e.sev = f.sev;
      m.set(a.name, e);
    }
    return [...m.values()].map(e => ({ ...e, safe: quantumSafe(e), migrate: migrateTo(e), status: nistStatus(e) }))
      .sort((a, b) => a.safe - b.safe || SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
  }

  function report() {
    const fs = allFindings();
    return {
      tool: 'tinkatuff', version: VERSION, url: redact(location.href), scannedAt: new Date().toISOString(),
      level: deep.done ? 'deep' : 'quick', ...grade(fs),
      findings: fs.map(f => ({ ...f, category: CATS[f.cat] })),
      inventory: inventory().map(e => ({ ...e, where: [...e.where] })),
      network: obs.net.filter(e => e.flags.length),
      console: obs.console,
    };
  }

  function cbom() {
    return {
      bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`, version: 1,
      metadata: { timestamp: new Date().toISOString(),
        tools: { components: [{ type: 'application', name: 'tinkatuff', version: VERSION }] },
        component: { type: 'application', name: location.hostname, 'bom-ref': location.origin } },
      components: inventory().map(e => ({
        type: 'cryptographic-asset', 'bom-ref': `crypto:${e.name}`, name: e.name,
        cryptoProperties: { assetType: 'algorithm', algorithmProperties: {
          primitive: e.primitive, nistQuantumSecurityLevel: e.nist ?? NIST_LEVEL[e.name] ?? (e.safe ? (isPqName(e.name) ? 3 : 1) : 0),
        } },
        evidence: { occurrences: [...e.where].map(w => ({ location: w })) },
        properties: [
          { name: 'tinkatuff:quantum-safe', value: String(e.safe) },
          { name: 'tinkatuff:migrate-to', value: e.migrate },
          { name: 'tinkatuff:nist-status', value: e.status },
        ],
      })),
    };
  }

  const slug = t => t.replace(/\d+/g, 'n').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  function sarif() {
    const fs = allFindings().filter(f => f.sev !== 'pass' && f.sev !== 'info');
    const rules = new Map();
    const results = fs.map(f => {
      const ruleId = `${f.cat}/${slug(f.title)}`;
      if (!rules.has(ruleId)) rules.set(ruleId, { id: ruleId, name: CATS[f.cat], shortDescription: { text: f.title },
        fullDescription: { text: [f.why, f.fix].filter(Boolean).join(' Fix: ') || f.title }, properties: { tags: ['post-quantum', f.cat] } });
      const locs = f.where.slice(0, 10).map(w => {
        const m = String(w).match(/(https?:\/\/[^\s]+?):(\d+):(\d+)/);
        if (m) return { physicalLocation: { artifactLocation: { uri: m[1] }, region: { startLine: +m[2], startColumn: +m[3] } } };
        const u = String(w).match(/https?:\/\/\S+/);
        return u ? { physicalLocation: { artifactLocation: { uri: u[0] } } } : { logicalLocations: [{ name: String(w).slice(0, 200) }] };
      });
      return { ruleId, level: f.sev === 'critical' || f.sev === 'high' ? 'error' : f.sev === 'medium' ? 'warning' : 'note',
        message: { text: [f.title, f.detail].filter(Boolean).join(' — ') }, locations: locs.length ? locs : [{ physicalLocation: { artifactLocation: { uri: location.origin } } }] };
    });
    return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [{ tool: { driver: { name: 'tinkatuff', version: VERSION, informationUri: 'https://github.com/vididvidid/aiutils', rules: [...rules.values()] } }, results }] };
  }

  function markdown() {
    const r = report();
    const lines = [`# Quantum exposure — ${location.host}`, '',
      `**Grade ${r.grade}** (${r.score}/100) · ${r.level} scan · ${new Date().toLocaleString()} · tinkatuff ${VERSION}`, ''];
    for (const [c, title] of Object.entries(CATS)) {
      const fs = r.findings.filter(f => f.cat === c);
      if (!fs.length) continue;
      lines.push(`## ${title}`, '');
      for (const f of fs) {
        lines.push(`- **${f.sev.toUpperCase()}** — ${f.plain || f.title}${f.plain ? ` _(${f.title})_` : ''}`);
        if (f.detail) lines.push(`  - ${f.detail}`);
        if (f.fix) lines.push(`  - Fix: ${f.fix}`);
        f.where.slice(0, 5).forEach(w => lines.push(`  - \`${String(w).replace(/`/g, "'")}\``));
      }
      lines.push('');
    }
    lines.push('## Crypto inventory', '', '| Algorithm | Primitive | Quantum-safe | Migrate to | NIST status | Seen |', '|---|---|---|---|---|---|');
    for (const e of r.inventory) lines.push(`| ${e.name} | ${e.primitive} | ${e.safe ? 'yes' : 'no'} | ${e.migrate} | ${e.status} | ${e.count} |`);
    return lines.join('\n');
  }

  // A ready-to-paste prompt for an AI assistant: instructions + the whole
  // report (already redacted — no tokens, keys or stored values).
  function aiPrompt() {
    const r = report();
    const fs = r.findings;
    const BUCKET_NAME = { now: 'BROKEN TODAY', hndl: 'RECORD NOW, DECRYPT LATER', forge: 'FORGEABLE LATER', weak: 'OTHER WEAK SPOT', safe: 'ALREADY SAFE' };
    const sens = pageSensitivity();
    const lines = [
      'You are a security engineer who specialises in post-quantum cryptography (PQC). Below is an automated scan of a website',
      'made by tinkatuff, a browser userscript. Explain it to me clearly, assuming I know web development but not cryptography.',
      '',
      'Please cover:',
      '1. Summary — in a few sentences, how ready this site is for quantum computers and what matters most.',
      '2. Each problem, grouped like the report — what it is, why it is a risk, and specifically how a cryptographically relevant',
      '   quantum computer changes it: Shor\'s algorithm (breaks RSA / ECC / DH) vs Grover\'s (halves symmetric strength),',
      '   "harvest now, decrypt later" (recorded traffic opened later) vs "forge later" (signatures faked once the machine exists).',
      '   Say who would be affected (visitors, the company, email recipients…) and how soon it matters, using NIST IR 8547',
      '   (RSA/ECC deprecated 2030, disallowed 2035) and CNSA 2.0 as reference points.',
      '3. Keep quantum issues and ordinary (non-quantum) security issues clearly apart.',
      '4. A prioritised action plan: now / within 6 months / before 2030 — with concrete changes (e.g. enable the TLS group',
      '   X25519MLKEM768, move key exchange to ML-KEM-768, signatures to ML-DSA-65, specific headers, cookie flags, DNS records).',
      '5. Which findings might be false positives or need manual checking (static matches in minified code, things a browser',
      '   extension cannot see such as the real TLS handshake or HttpOnly cookies), and how to verify them.',
      '6. What the site already does well.',
      'Only use what is in the report — do not invent findings. If something is unclear, say so.',
      '',
      '=== SCAN ===',
      `Site: ${location.origin}`,
      `Scan: ${r.level === 'deep' ? 'deep (page + network lookups: DNS, CT logs, headers, scripts)' : 'quick (this page only — no DNS / certificate / TLS lookups yet)'}, ${new Date().toISOString()}, tinkatuff ${VERSION}`,
      `Grade: ${r.grade} (${r.score}/100; A best, F worst)`,
      `Page handles: ${sens.length ? sens.join(', ') : 'nothing sensitive detected'}`,
      `Browser: ${navigator.userAgent}`,
      `Watched so far: ${obs.net.length} network requests, ${obs.crypto.size} distinct WebCrypto operations, ${obs.console.length} crypto-related console lines`,
      '',
    ];
    for (const [id] of BUCKETS) {
      const group = fs.filter(f => bucketOf(f) === id);
      if (!group.length) continue;
      lines.push(`=== ${BUCKET_NAME[id]} (${group.length}) ===`);
      for (const f of group) {
        lines.push(`- [${f.sev}] ${f.title}${f.plain && f.plain !== f.title ? ` — ${f.plain}` : ''}`, `  area: ${f.category}`);
        if (f.detail) lines.push(`  detail: ${f.detail}`);
        if (f.fix) lines.push(`  suggested fix: ${f.fix}`);
        if (f.where.length) lines.push(`  seen at: ${f.where.slice(0, 5).join(' | ')}${f.where.length > 5 ? ` (+${f.where.length - 5} more)` : ''}`);
      }
      lines.push('');
    }
    const info = fs.filter(f => f.sev === 'info');
    if (info.length) lines.push('=== NOTES (no score impact) ===', ...info.map(f => `- ${f.title}${f.detail ? ` — ${f.detail}` : ''}`), '');
    if (r.inventory.length) {
      lines.push('=== CRYPTO INVENTORY (algorithm | use | quantum-safe | migrate to | NIST status | times seen) ===');
      for (const e of r.inventory) lines.push(`- ${e.name} | ${e.primitive} | ${e.safe ? 'yes' : 'no'} | ${e.migrate} | ${e.status} | ${e.count}`);
      lines.push('');
    }
    lines.push('(Tokens, keys and stored values were redacted by the scanner; only their algorithms and locations are listed.)');
    return lines.join('\n');
  }

  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    (document.body || document.documentElement).append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function copy(text) {
    if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
    else if (navigator.clipboard) navigator.clipboard.writeText(text);
  }

  // ── 10. UI ────────────────────────────────────────────────────────────────
  const GRADE_COLOR = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };
  const SEV_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#60a5fa', info: '#64748b', pass: '#22c55e' };

  const VERDICT = {
    A: 'Well prepared for quantum computers.',
    B: 'Mostly fine — a few things to plan for.',
    C: 'Several parts could be broken by future quantum computers.',
    D: 'Exposed — important data could be recorded now and read later.',
    F: 'Serious problems — some can be exploited even today.',
  };

  // The summary sorts every problem into one of these, in plain words.
  const BUCKETS = [
    ['now',   '#ef4444', 'Broken today — fix first', 'Anyone can exploit these right now, no quantum computer needed.'],
    ['hndl',  '#f97316', 'Can be recorded now, unlocked later', 'Attackers can save this traffic or data today and decrypt it once quantum computers are strong enough.'],
    ['forge', '#eab308', 'Could be faked later', 'A future quantum computer could forge these signatures, logins or certificates.'],
    ['weak',  '#60a5fa', 'Other weak spots', 'Outdated settings worth fixing anyway.'],
    ['safe',  '#22c55e', 'Already quantum-safe', ''],
  ];
  function bucketOf(f) {
    if (f.sev === 'pass') return 'safe';
    if (f.sev === 'info') return null;
    if (f.sev === 'critical' || f.why === WHY.leak) return 'now';
    if (f.why === WHY.hndl) return 'hndl';
    if (f.why === WHY.forge) return 'forge';
    return 'weak';
  }

  const DARK = `--bg:#0b1220; --card:#0f172a; --line:#1e293b; --line2:#334155; --text:#e2e8f0; --text2:#cbd5e1; --muted:#94a3b8;
    --faint:#64748b; --link:#93c5fd; --accent:#6366f1; --accentText:#a5b4fc; --btn:#1e293b; --btnHover:#273449;
    --flagBg:#312e81; --flagText:#c7d2fe; --badBg:#7c2d12; --badText:#fed7aa; --ok:#22c55e; --no:#fb923c; --shadow:rgba(0,0,0,.5);`;
  const LIGHT = `--bg:#ffffff; --card:#f8fafc; --line:#e2e8f0; --line2:#cbd5e1; --text:#0f172a; --text2:#334155; --muted:#475569;
    --faint:#64748b; --link:#1d4ed8; --accent:#4f46e5; --accentText:#4338ca; --btn:#f1f5f9; --btnHover:#e2e8f0;
    --flagBg:#e0e7ff; --flagText:#3730a3; --badBg:#ffedd5; --badText:#9a3412; --ok:#15803d; --no:#c2410c; --shadow:rgba(15,23,42,.18);`;

  const CSS = `
    :host { all: initial; ${DARK} }
    :host([data-theme="light"]) { ${LIGHT} }
    @media (prefers-color-scheme: light) { :host([data-theme="auto"]) { ${LIGHT} } }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .badge { position: fixed; left: 14px; top: calc(100vh - 54px); z-index: 2147483646; display: flex; align-items: center; gap: 7px;
      padding: 4px 10px 4px 4px; border-radius: 999px; background: var(--card); color: var(--text); font-size: 12px; font-weight: 600;
      border: 1px solid var(--line2); box-shadow: 0 4px 14px var(--shadow); cursor: grab; user-select: none; touch-action: none; opacity: .92; }
    .badge:hover, .badge:focus-visible { opacity: 1; outline: none; box-shadow: 0 0 0 2px var(--accent), 0 4px 14px var(--shadow); }
    .badge.drag { cursor: grabbing; opacity: 1; }
    .badge .g { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; display: grid; place-items: center; color: #0b1220; font-weight: 800; }
    .logo { border-radius: 50%; object-fit: cover; flex: none; display: block; }
    .panel { position: fixed; right: 16px; top: 16px; z-index: 2147483647; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
      display: flex; flex-direction: column; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: 0 20px 50px var(--shadow); font-size: 13px; line-height: 1.5; }
    .hd { display: flex; gap: 12px; align-items: center; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
    .grade { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; }
    .grade .gl { font-size: 10px; text-transform: uppercase; letter-spacing: .6px; color: var(--faint); }
    .ring { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; font-weight: 800; color: #0b1220; flex: none; }
    .ttl { font-size: 16px; font-weight: 700; letter-spacing: .2px; }
    .sub { color: var(--muted); font-size: 12px; word-break: break-all; }
    .acts { margin-left: auto; display: flex; gap: 2px; align-self: flex-start; }
    .icon { background: none; border: 0; color: var(--muted); font-size: 17px; line-height: 1; cursor: pointer; padding: 5px 7px; border-radius: 7px; }
    .icon:hover { background: var(--btn); color: var(--text); }
    .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
    button.b { background: var(--btn); color: var(--text); border: 1px solid var(--line2); border-radius: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
    button.b:hover { background: var(--btnHover); }
    button.b.pri { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.b.ai { border-color: var(--accent); color: var(--accentText); font-weight: 600; }
    button.b:disabled { opacity: .5; cursor: default; }
    .tabs { display: flex; gap: 2px; padding: 6px 16px 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
    .tab { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted); padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .tab.on { color: var(--text); border-bottom-color: var(--accent); }
    .hd, .bar, .tabs, .step, .foot { flex: none; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 16px 16px; }
    .step { color: var(--accentText); font-size: 12px; padding: 6px 16px 0; }
    .verdict { margin: 12px 0 4px; padding: 12px 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
    .verdict .v { font-size: 15px; font-weight: 700; }
    .verdict .i { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .bucket { margin-top: 16px; }
    .bh { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
    .bs { color: var(--muted); font-size: 12px; margin: 2px 0 6px 18px; }
    details.bucket > summary { cursor: pointer; list-style: none; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; display: inline-block; }
    .item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; margin: 5px 0; border-radius: 8px; background: var(--card);
      border: 1px solid var(--line); cursor: pointer; }
    .item:hover, .item:focus-visible { border-color: var(--accent); outline: none; }
    .item .dot { margin-top: 6px; }
    .item .tx { flex: 1; }
    .item .n { color: var(--faint); font-size: 11px; }
    .item .go { color: var(--accentText); font-size: 12px; white-space: nowrap; }
    h2.sec { font-size: 12px; text-transform: uppercase; letter-spacing: .7px; color: var(--faint); margin: 24px 0 2px; border-top: 1px solid var(--line); padding-top: 14px; }
    details.cat { margin-top: 8px; }
    details.cat > summary { cursor: pointer; font-weight: 700; color: var(--text2); padding: 4px 0; list-style: none; }
    details.cat > summary::before { content: "▸ "; color: var(--faint); }
    details.cat[open] > summary::before { content: "▾ "; }
    .card { border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: var(--card); }
    .card.flash { animation: flash 1.8s ease-out; }
    @keyframes flash { 0% { box-shadow: 0 0 0 3px var(--accent); } 100% { box-shadow: 0 0 0 0 transparent; } }
    .row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .pill { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; padding: 1px 6px; border-radius: 4px; color: #0b1220; flex: none; }
    .t { font-weight: 600; }
    .d { color: var(--text2); margin-top: 4px; }
    .why, .fix { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .fix b, .why b { color: var(--text2); }
    .mono, .where { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .where { margin-top: 5px; color: var(--link); white-space: pre-wrap; word-break: break-all; }
    .where div { padding: 1px 0; }
    .more { color: var(--faint); cursor: pointer; }
    .tools { display: flex; gap: 10px; align-items: center; color: var(--muted); font-size: 12px; padding: 8px 0; flex-wrap: wrap; }
    .net { border-bottom: 1px solid var(--line); padding: 6px 0; }
    .net .m { color: var(--accentText); font-weight: 700; margin-right: 6px; }
    .net .s { color: var(--faint); margin-left: 6px; }
    .net .u { word-break: break-all; }
    .flag { display: inline-block; margin: 3px 4px 0 0; padding: 0 6px; border-radius: 4px; background: var(--flagBg); color: var(--flagText); font-size: 11px; }
    .flag.bad { background: var(--badBg); color: var(--badText); }
    .lvl { font-weight: 700; margin-right: 6px; text-transform: uppercase; font-size: 10px; }
    .inv { display: grid; grid-template-columns: 1.3fr .8fr .5fr 1.4fr .5fr; font-size: 12px; }
    .inv > div { padding: 5px 6px; border-bottom: 1px solid var(--line); word-break: break-word; }
    .inv .h { color: var(--faint); font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .ok { color: var(--ok); font-weight: 700; } .no { color: var(--no); font-weight: 700; }
    .empty { color: var(--faint); padding: 16px 0; }
    .set { padding: 12px 0; border-bottom: 1px solid var(--line); }
    .set h4 { margin: 0 0 8px; font-size: 13px; }
    .set .row { align-items: center; }
    .seg { display: inline-flex; border: 1px solid var(--line2); border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: var(--btn); color: var(--text); padding: 5px 14px; font-size: 12px; cursor: pointer; }
    .seg button.on { background: var(--accent); color: #fff; }
    .note { color: var(--faint); font-size: 11px; margin-top: 6px; }
    .foot { color: var(--faint); font-size: 11px; padding: 8px 16px 12px; border-top: 1px solid var(--line); }
  `;

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    children.forEach(c => el.append(c));
    return el;
  }

  // Default logo: a little pink hammer. Inline SVG, so no CSP can block it.
  function defaultLogo(size) {
    return svg('svg', { viewBox: '0 0 32 32', width: size, height: size, class: 'logo', 'aria-hidden': 'true' },
      svg('circle', { cx: 16, cy: 16, r: 16, fill: '#ec4899' }),
      svg('g', { transform: 'rotate(-35 16 16)' },
        svg('rect', { x: 14.6, y: 12, width: 2.8, height: 14, rx: 1.4, fill: '#fdf2f8' }),
        svg('rect', { x: 8, y: 6.5, width: 16, height: 7, rx: 2.2, fill: '#fbcfe8', stroke: '#fdf2f8', 'stroke-width': 1.4 })));
  }
  // A custom logo is a data: URL; a page whose CSP forbids data: images falls back to the hammer.
  function logoEl(size) {
    if (!settings.logo) return defaultLogo(size);
    const img = h('img', { class: 'logo', src: settings.logo, width: size, height: size, alt: '' });
    img.addEventListener('error', () => img.replaceWith(defaultLogo(size)), { once: true });
    return img;
  }

  // Any picture → 128 px PNG data URL (small enough for GM storage).
  async function imageToDataUrl(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } catch (_) {
      if (blob.size > 300_000) throw new Error('image too large or in an unsupported format');
      return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    }
  }
  function setLogo(dataUrl) {
    settings.logo = dataUrl;
    store.set('logo', dataUrl);
    render();
  }
  async function logoFromUrlPrompt() {
    const url = prompt('Image URL for the tinkatuff logo (PNG, JPG, GIF, WebP or SVG):');
    if (!url) return;
    try {
      const r = await gm(url.trim(), { binary: true, timeout: 20000 });
      if (!r.bytes || r.status >= 400) throw new Error(`HTTP ${r.status}`);
      setLogo(await imageToDataUrl(new Blob([r.bytes], { type: r.headers['content-type'] || 'image/png' })));
    } catch (e) { alert(`tinkatuff: could not load that image (${e.message}).`); }
  }

  const ui = {
    host: null, root: null, badge: null, panel: null, fileInput: null, open: false, tab: 'report',
    flaggedOnly: true, showExport: false, badgePos: null, closedCats: new Set(Object.keys(CATS)),
  };

  function applyTheme() { if (ui.host) ui.host.setAttribute('data-theme', settings.theme); }

  // ── Floating button: drag anywhere, click to open ──
  function placeBadge(left, top) {
    const r = ui.badge.getBoundingClientRect();
    const w = r.width || 90, hh = r.height || 34;
    left = Math.min(Math.max(4, left), innerWidth - w - 4);
    top = Math.min(Math.max(4, top), innerHeight - hh - 4);
    ui.badge.style.left = `${left}px`;
    ui.badge.style.top = `${top}px`;
    ui.badgePos = { left, top, w, hh };
  }
  // Saved as a fraction of the free space, so the spot survives other window sizes.
  function restoreBadge() {
    const r = ui.badge.getBoundingClientRect();
    const w = r.width || 90, hh = r.height || 34;
    const p = settings.pos;
    if (p) placeBadge(p.xr * (innerWidth - w), p.yr * (innerHeight - hh));
    else placeBadge(14, innerHeight - hh - 14);
  }
  function saveBadge() {
    const { left, top, w, hh } = ui.badgePos;
    settings.pos = { xr: left / Math.max(1, innerWidth - w), yr: top / Math.max(1, innerHeight - hh) };
    store.set('badgePos', settings.pos);
  }
  function makeDraggable(el) {
    let start = null, moved = false;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      moved = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;   // a click, not a drag (yet)
      moved = true;
      el.classList.add('drag');
      placeBadge(start.left + dx, start.top + dy);
    });
    const end = () => {
      if (!start) return;
      start = null;
      el.classList.remove('drag');
      if (moved) { saveBadge(); if (ui.open) render(); }
      else toggle();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { start = null; el.classList.remove('drag'); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }

  function mountUi() {
    if (ui.host || !document.documentElement) return;
    ui.host = h('div', { id: 'tinkatuff-root' });
    ui.root = ui.host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      ui.root.adoptedStyleSheets = [sheet];   // constructable sheets aren't blocked by a strict style-src CSP
    } catch (_) {
      ui.root.append(h('style', null, CSS));
    }
    ui.badge = h('div', { class: 'badge', role: 'button', tabindex: '0', 'aria-label': 'tinkatuff quantum report' });
    makeDraggable(ui.badge);
    ui.panel = h('div', { class: 'panel', style: 'display:none' });
    ui.fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: async ev => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try { setLogo(await imageToDataUrl(file)); } catch (e) { alert(`tinkatuff: ${e.message}`); }
    } });
    ui.root.append(ui.badge, ui.panel, ui.fileInput);
    document.documentElement.append(ui.host);
    applyTheme();
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.open) toggle(false); }, true);
    // A click anywhere outside the badge / panel closes the report (closed shadow root: the host is still in the path)
    document.addEventListener('pointerdown', e => { if (ui.open && !e.composedPath().includes(ui.host)) toggle(false); }, true);
    window.addEventListener('resize', () => restoreBadge());
  }

  function toggle(force) {
    ui.open = force ?? !ui.open;
    if (ui.open) runQuick(); else render();
  }

  // Brief "Copied ✓" on a button (survives no re-render, which is fine for 1.5 s)
  function flashCopied(btn) {
    const label = btn.textContent;
    btn.textContent = 'Copied ✓ — paste it into your AI';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
  }

  function jumpTo(fid) {
    const f = allFindings()[fid];
    if (!f) return;
    ui.closedCats.delete(f.cat);
    render();
    const el = ui.panel.querySelector(`[data-fid="${fid}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); }
  }

  function whereList(where, n = 4) {
    if (!where.length) return null;
    const el = h('div', { class: 'where' });
    const fill = k => {
      el.textContent = '';
      where.slice(0, k).forEach(w => el.append(h('div', null, w)));
      if (where.length > k) el.append(h('div', { class: 'more', onclick: () => fill(where.length) }, `+ ${where.length - k} more`));
    };
    fill(n);
    return el;
  }

  function card(f, fid) {
    return h('div', { class: 'card', 'data-fid': String(fid), style: `border-left-color:${SEV_COLOR[f.sev]}` },
      h('div', { class: 'row' }, h('span', { class: 'pill', style: `background:${SEV_COLOR[f.sev]}` }, f.sev), h('span', { class: 't' }, f.title)),
      f.plain && f.plain !== f.title && h('div', { class: 'd' }, f.plain),
      f.detail && h('div', { class: 'd' }, f.detail),
      f.why && h('div', { class: 'why' }, h('b', null, 'Quantum: '), f.why),
      f.fix && h('div', { class: 'fix' }, h('b', null, 'Fix: '), f.fix),
      whereList(f.where));
  }

  // Plain-language list first: one line per problem, grouped by what it means.
  function viewSummary(fs) {
    const { grade: g } = grade(fs);
    const groups = new Map(BUCKETS.map(b => [b[0], new Map()]));
    fs.forEach((f, i) => {
      const b = bucketOf(f);
      if (!b) return;
      const text = f.plain || f.title;
      const m = groups.get(b);
      const e = m.get(text) || { text, sev: f.sev, fid: i, n: 0 };
      e.n++;
      m.set(text, e);
    });
    const problems = ['now', 'hndl', 'forge', 'weak'].reduce((s, b) => s + groups.get(b).size, 0);
    const out = [h('div', { class: 'verdict' },
      h('div', { class: 'v' }, VERDICT[g]),
      h('div', { class: 'i' }, problems
        ? `${problems} thing${problems > 1 ? 's' : ''} to look at. Future quantum computers could break most of today's internet encryption — here is what that means for this site. Click a line for the details.`
        : 'Nothing quantum-vulnerable found so far. Keep using the site — findings appear as it loads more.'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        !deep.done && !deep.running && h('button', { class: 'b pri', onclick: runDeep }, 'Run deep scan — also checks the connection, certificate, email & DNS'),
        h('button', { class: 'b ai', onclick: ev => { copy(aiPrompt()); flashCopied(ev.currentTarget); } }, '✨ Copy for AI — get it explained in detail')))];
    for (const [id, color, title, sub] of BUCKETS) {
      const items = [...groups.get(id).values()].sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
      if (!items.length) continue;
      const list = items.map(e => h('div', { class: 'item', role: 'button', tabindex: '0',
        onclick: () => jumpTo(e.fid), onkeydown: ev => { if (ev.key === 'Enter') jumpTo(e.fid); } },
        h('span', { class: 'dot', style: `background:${SEV_COLOR[e.sev]}` }),
        h('span', { class: 'tx' }, e.text, e.n > 1 && h('span', { class: 'n' }, `  ×${e.n}`)),
        h('span', { class: 'go' }, 'details ›')));
      const head = h('div', { class: 'bh' }, h('span', { class: 'dot', style: `background:${color}` }), `${title} (${items.length})`);
      out.push(id === 'safe'
        ? h('details', { class: 'bucket' }, h('summary', null, head), list)
        : h('div', { class: 'bucket' }, head, sub && h('div', { class: 'bs' }, sub), list));
    }
    return out;
  }

  function viewDetails(fs) {
    const byCat = new Map(Object.keys(CATS).map(c => [c, []]));
    fs.forEach((f, i) => byCat.get(f.cat).push([f, i]));
    return [
      h('h2', { class: 'sec' }, 'Full details'),
      h('div', { class: 'note' }, 'Everything found, by area, with where it was seen and how to fix it.'),
      [...byCat].filter(([, l]) => l.length).map(([c, l]) => {
        const d = h('details', { class: 'cat', open: !ui.closedCats.has(c) }, h('summary', null, `${CATS[c]}  (${l.length})`), l.map(([f, i]) => card(f, i)));
        d.addEventListener('toggle', () => { d.open ? ui.closedCats.delete(c) : ui.closedCats.add(c); });
        return d;
      }),
    ];
  }

  function viewInventory() {
    const inv = inventory();
    if (!inv.length) return h('div', { class: 'empty' }, 'No cryptographic assets identified yet.');
    return [
      h('div', { class: 'tools' }, `${inv.length} algorithm(s) · ${inv.filter(e => !e.safe).length} not quantum-safe · the CBOM export carries this table`),
      h('div', { class: 'inv' },
        ['Algorithm', 'Primitive', 'Safe', 'Migrate to / NIST', 'Seen'].map(t => h('div', { class: 'h' }, t)),
        inv.map(e => [
          h('div', { class: 'mono', title: [...e.where].join('\n') }, e.name),
          h('div', null, e.primitive),
          h('div', { class: e.safe ? 'ok' : 'no' }, e.safe ? 'yes' : 'no'),
          h('div', null, e.migrate, h('div', { class: 'sub' }, e.status)),
          h('div', null, String(e.count)),
        ])),
    ];
  }

  const isBadFlag = f => /PRIVATE|plain HTTP|RSA-\d+-sized|private!/.test(f);
  function viewNetwork() {
    const rows = obs.net.filter(e => !ui.flaggedOnly || e.flags.length).slice(-200).reverse();
    return [
      h('div', { class: 'tools' },
        h('label', null, h('input', { type: 'checkbox', checked: ui.flaggedOnly, onchange: ev => { ui.flaggedOnly = ev.target.checked; render(); } }), ' flagged only'),
        `${obs.net.length} request(s) watched since load${settings.network ? '' : ' — network capture is OFF (Settings)'}`),
      rows.length ? rows.map(e => h('div', { class: 'net' },
        h('span', { class: 'm mono' }, e.method), h('span', { class: 'u mono' }, e.url), h('span', { class: 's mono' }, String(e.status || '…')),
        e.flags.length && h('div', null, [...new Set(e.flags)].map(f => h('span', { class: `flag${isBadFlag(f) ? ' bad' : ''}` }, f)))))
        : h('div', { class: 'empty' }, ui.flaggedOnly ? 'Nothing flagged yet. Log in or use the site — tokens, keys and encrypted fields show up here.' : 'No requests yet.'),
    ];
  }

  const LVL_COLOR = { error: '#ef4444', uncaught: '#ef4444', warn: '#eab308', info: '#60a5fa', log: '#94a3b8', debug: '#64748b', trace: '#64748b' };
  function viewConsole() {
    const rows = obs.console.slice(-150).reverse();
    return [
      h('div', { class: 'tools' }, settings.console ? 'Console lines that mention crypto, keys or tokens (tokens and keys redacted).' : 'Console capture is OFF (Settings).'),
      rows.length ? rows.map(c => h('div', { class: 'net' },
        h('span', { class: 'lvl', style: `color:${LVL_COLOR[c.level] || '#94a3b8'}` }, c.level), h('span', { class: 'mono' }, c.text),
        c.where && h('div', { class: 'sub mono' }, c.where),
        c.flags.length && h('div', null, c.flags.map(f => h('span', { class: `flag${isBadFlag(f) ? ' bad' : ''}` }, f)))))
        : h('div', { class: 'empty' }, 'Nothing crypto-related logged yet.'),
    ];
  }

  const flipSetting = (key, storeKey) => () => { settings[key] = !settings[key]; store.set(storeKey, settings[key]); render(); };
  function setTheme(v) { settings.theme = v; store.set('theme', v); applyTheme(); render(); }
  function setRadarToken() {
    const t = prompt('Cloudflare API token with "User Details: Read" — enables a real PQ-TLS handshake test per origin.\nLeave empty to remove.', settings.radar);
    if (t === null) return;
    settings.radar = t.trim();
    store.set('radarToken', settings.radar);
    render();
  }

  function viewSettings() {
    const seg = (opts, cur, set) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: () => set(v) }, l)));
    return [
      h('div', { class: 'set' }, h('h4', null, 'Theme'),
        seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], settings.theme, setTheme),
        h('div', { class: 'note' }, 'Auto follows your system\'s light / dark setting.')),
      h('div', { class: 'set' }, h('h4', null, 'Logo'),
        h('div', { class: 'row' }, logoEl(40),
          h('button', { class: 'b', onclick: () => ui.fileInput.click() }, 'Choose image…'),
          h('button', { class: 'b', onclick: logoFromUrlPrompt }, 'From URL…'),
          settings.logo && h('button', { class: 'b', onclick: () => setLogo('') }, 'Reset')),
        h('div', { class: 'note' }, 'Use any picture you like. It is shrunk to 128 px and kept in Tampermonkey\'s storage on this computer — never in the script file.')),
      h('div', { class: 'set' }, h('h4', null, 'Floating button'),
        h('div', { class: 'row' },
          h('button', { class: 'b', onclick: () => { settings.pos = null; store.set('badgePos', null); restoreBadge(); render(); } }, 'Move back to the corner'),
          h('button', { class: 'b', onclick: flipSetting('badge', 'badge') }, settings.badge ? 'Hide while the panel is closed' : 'Always show')),
        h('div', { class: 'note' }, 'Drag the button anywhere; the spot is remembered on every site. Hidden? Tampermonkey menu → "Open quantum report".')),
      h('div', { class: 'set' }, h('h4', null, 'What to watch'),
        h('div', { class: 'row' },
          h('button', { class: 'b', onclick: flipSetting('network', 'networkCapture') }, `Network: ${settings.network ? 'on' : 'off'}`),
          h('button', { class: 'b', onclick: flipSetting('console', 'consoleCapture') }, `Console: ${settings.console ? 'on' : 'off'}`),
          h('button', { class: 'b', onclick: flipSetting('autoDeep', 'autoDeep') }, `Auto deep scan: ${settings.autoDeep ? 'on' : 'off'}`)),
        h('div', { class: 'note' }, 'Network and console changes apply after a page reload. Console capture makes DevTools show this script as the source of every log line. Auto deep scan looks up every site you open on dns.google and crt.sh.')),
      h('div', { class: 'set' }, h('h4', null, 'Cloudflare Radar token'),
        h('button', { class: 'b', onclick: setRadarToken }, settings.radar ? 'Change / remove token' : 'Add token'),
        h('div', { class: 'note' }, 'Optional. Lets the deep scan run a real TLS handshake test against each server for post-quantum key exchange.')),
    ];
  }

  const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
  const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' };

  function render() {
    if (!ui.host) return;
    const fs = allFindings();
    const { score, grade: g } = grade(fs);

    ui.badge.style.display = settings.badge || ui.open ? '' : 'none';
    ui.badge.textContent = '';
    ui.badge.append(logoEl(26), h('span', { class: 'g', style: `background:${GRADE_COLOR[g]}` }, g), deep.running ? 'scanning…' : 'quantum');
    ui.badge.title = `tinkatuff — quantum-readiness grade ${g} (A best, F worst, ${score}/100). Click for the report, drag to move.`;
    if (ui.badgePos) placeBadge(ui.badgePos.left, ui.badgePos.top);   // width may have changed
    ui.panel.style.display = ui.open ? '' : 'none';
    if (!ui.open) return;

    // open the panel on the side of the screen the button sits on
    const br = ui.badge.getBoundingClientRect();
    const right = !br.width || br.left + br.width / 2 > innerWidth / 2;
    ui.panel.style.right = right ? '16px' : 'auto';
    ui.panel.style.left = right ? 'auto' : '16px';

    const flagged = obs.net.filter(e => e.flags.length).length;
    const tabs = [['report', 'Report'], ['inventory', 'Inventory'], ['network', `Network (${flagged}/${obs.net.length})`],
      ['console', `Console (${obs.console.length})`], ['settings', 'Settings']];
    const views = { report: () => [viewSummary(fs), viewDetails(fs)], inventory: viewInventory, network: viewNetwork, console: viewConsole, settings: viewSettings };
    const body = h('div', { class: 'body' }, views[ui.tab]());

    const prevScroll = ui.panel.querySelector('.body')?.scrollTop || 0;
    ui.panel.textContent = '';
    ui.panel.append(
      h('div', { class: 'hd' },
        logoEl(42),
        h('div', null, h('div', { class: 'ttl' }, 'tinkatuff'),
          h('div', { class: 'sub' }, location.host),
          h('div', { class: 'sub' }, `${score}/100 · ${deep.done ? `deep scan ${deep.time.toLocaleTimeString()}` : 'quick scan (this page only)'}`)),
        h('div', { class: 'grade', title: `Quantum-readiness grade: A is best, F is worst (${score}/100)` },
          h('div', { class: 'ring', style: `background:${GRADE_COLOR[g]}` }, g), h('div', { class: 'gl' }, 'grade')),
        h('div', { class: 'acts' },
          h('button', { class: 'icon', title: `Theme: ${settings.theme} (click to change)`, onclick: () => setTheme(NEXT_THEME[settings.theme]) }, THEME_ICON[settings.theme]),
          h('button', { class: 'icon', title: 'Settings', onclick: () => { ui.tab = 'settings'; render(); } }, '⚙'),
          h('button', { class: 'icon', title: 'Close (Esc)', onclick: () => toggle(false) }, '×'))),
      h('div', { class: 'bar' },
        h('button', { class: 'b pri', disabled: deep.running, onclick: runDeep }, deep.running ? 'Scanning…' : deep.done ? 'Deep scan again' : 'Deep scan'),
        h('button', { class: 'b ai', title: 'Copies the whole result as a prompt — paste it into ChatGPT, Claude, Gemini… for a detailed explanation and a fix plan',
          onclick: ev => { copy(aiPrompt()); flashCopied(ev.currentTarget); } }, '✨ Copy for AI'),
        h('button', { class: 'b', onclick: runQuick }, 'Rescan page'),
        h('button', { class: 'b', onclick: () => { ui.showExport = !ui.showExport; render(); } }, ui.showExport ? 'Export ▴' : 'Export ▾'),
        ui.showExport && [
          h('button', { class: 'b', title: 'Full report as JSON to the clipboard', onclick: () => copy(JSON.stringify(report(), null, 2)) }, 'Copy JSON'),
          h('button', { class: 'b', title: 'Markdown report to the clipboard', onclick: () => copy(markdown()) }, 'Copy Markdown'),
          h('button', { class: 'b', title: 'CycloneDX 1.6 cryptographic bill of materials', onclick: () => download(`cbom-${location.hostname}.json`, JSON.stringify(cbom(), null, 2)) }, 'CBOM file'),
          h('button', { class: 'b', title: 'SARIF 2.1.0 (GitHub code scanning, IDEs)', onclick: () => download(`tinkatuff-${location.hostname}.sarif`, JSON.stringify(sarif(), null, 2)) }, 'SARIF file'),
        ]),
      h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: `tab${ui.tab === id ? ' on' : ''}`, onclick: () => { ui.tab = id; render(); } }, label))),
      deep.step && h('div', { class: 'step' }, deep.step),
      body,
      h('div', { class: 'foot' }, `tinkatuff ${VERSION} · findings are pointers, not proof — confirm before acting.`));
    body.scrollTop = prevScroll;
  }

  // ── 11. Menu & startup ────────────────────────────────────────────────────
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open quantum report', () => toggle(true));
    GM_registerMenuCommand('Deep scan this site', () => { toggle(true); runDeep(); });
    GM_registerMenuCommand('Settings', () => { ui.tab = 'settings'; toggle(true); });
    GM_registerMenuCommand('Toggle floating badge', () => { flipSetting('badge', 'badge')(); });
    GM_registerMenuCommand('Move badge back to the corner', () => { settings.pos = null; store.set('badgePos', null); restoreBadge(); });
  }

  function start() {
    mountUi();
    runQuick();
    restoreBadge();
    LOG(`v${VERSION} loaded`);
    if (settings.autoDeep) runDeep();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  // late-loading scripts, libraries and crypto calls
  window.addEventListener('load', () => setTimeout(runQuick, 2500), { once: true });
})();
