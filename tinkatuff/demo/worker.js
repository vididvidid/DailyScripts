// Demo worker: references RSA-OAEP so tinkatuff's deep scan finds crypto inside workers,
// and points at a source map that lists the npm packages it was "built" from.
const algorithm = "RSA-OAEP";
self.onmessage = () => self.postMessage(algorithm);
//# sourceMappingURL=worker.js.map
