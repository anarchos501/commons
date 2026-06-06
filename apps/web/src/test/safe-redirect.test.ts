import assert from "node:assert/strict";
import test from "node:test";
import { safeRelativeRedirectPath } from "../lib/safe-redirect";

test("safeRelativeRedirectPath accepts same-origin relative paths", () => {
  assert.equal(safeRelativeRedirectPath("/invite/abc123"), "/invite/abc123");
  assert.equal(safeRelativeRedirectPath("/groups?applied=1#members"), "/groups?applied=1#members");
});

test("safeRelativeRedirectPath rejects open-redirect shapes", () => {
  assert.equal(safeRelativeRedirectPath("https://example.com"), null);
  assert.equal(safeRelativeRedirectPath("//example.com"), null);
  assert.equal(safeRelativeRedirectPath("/\\example.com"), null);
  assert.equal(safeRelativeRedirectPath("/invite/abc\nLocation:%20//example.com"), null);
  assert.equal(safeRelativeRedirectPath(null), null);
});
