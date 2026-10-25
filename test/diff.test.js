import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePatch } from "../src/diff.js";

test("numbers added lines in the new file and removed lines in the old file", () => {
  const patch = "@@ -10,4 +10,4 @@ ctx\n a\n-b\n+B\n c\n@@ -40 +40,2 @@\n x\n+y";
  assert.deepEqual(parsePatch(patch), [
    { op: "-", line: 11, text: "b" },
    { op: "+", line: 11, text: "B" },
    { op: "+", line: 41, text: "y" },
  ]);
});

test("ignores the no-newline marker and handles new files", () => {
  assert.deepEqual(parsePatch("@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file"), [
    { op: "+", line: 1, text: "a" },
    { op: "+", line: 2, text: "b" },
  ]);
});

test("returns nothing without a patch", () => {
  assert.deepEqual(parsePatch(undefined), []);
  assert.deepEqual(parsePatch(""), []);
});
