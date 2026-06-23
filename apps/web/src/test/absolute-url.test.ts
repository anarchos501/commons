import assert from "node:assert/strict";
import test from "node:test";
import { absoluteUrl, resolvePublicBaseUrl } from "../lib/node-context";

test("absoluteUrl prefers the node's real domain over the request host (production link)", () => {
  // A proxy mangling the Host header to localhost must NOT leak into the production link.
  assert.equal(
    absoluteUrl("05661collective.cloud", "localhost:3000", "/request/status/abc"),
    "https://05661collective.cloud/request/status/abc",
  );
});

test("absoluteUrl falls back to the request host (with dev port) when the node domain is a localhost alias", () => {
  assert.equal(
    absoluteUrl("localhost", "localhost:3000", "/request/status/abc"),
    "http://localhost:3000/request/status/abc",
  );
});

test("resolvePublicBaseUrl uses https for a real domain and http for localhost", () => {
  assert.equal(resolvePublicBaseUrl("example.org", null), "https://example.org");
  assert.equal(resolvePublicBaseUrl("localhost", "localhost:3000"), "http://localhost:3000");
  // No usable host anywhere → safe dev default.
  assert.equal(resolvePublicBaseUrl(null, null), "http://localhost:3000");
});

test("absoluteUrl normalizes a path that is missing its leading slash", () => {
  assert.equal(absoluteUrl("example.org", null, "invite/xyz"), "https://example.org/invite/xyz");
});
