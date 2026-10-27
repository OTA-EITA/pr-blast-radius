import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/analyze.js";

/**
 * Ids of the findings for one added (or removed) line in a file.
 * @param {string} filename @param {string} line @param {"+" | "-"} [op]
 */
const ids = (filename, line, op = "+") =>
  analyze([{ filename, status: "modified", patch: `@@ -1 +1 @@\n${op}${line}` }]).findings.map((f) => f.id);

test("dangerous capabilities added to a container", () => {
  for (const line of [
    "              add: [SYS_ADMIN]",
    '              add: ["NET_BIND_SERVICE", "NET_ADMIN"]',
    "              add: ['ALL']",
    "                - SYS_PTRACE",
    '                - "CAP_SYS_ADMIN"',
  ])
    assert.deepEqual(ids("k8s/api.yaml", line), ["dangerous-capability"], line);
  assert.deepEqual(ids("docker-compose.yml", "    cap_add: [ALL]"), ["dangerous-capability"]);
  assert.deepEqual(ids("compose.yaml", "      - NET_ADMIN"), ["dangerous-capability"]);
});

test("dropping capabilities or adding baseline ones is fine", () => {
  for (const line of [
    '              drop: ["ALL"]',
    "                - ALL",
    '              add: ["NET_BIND_SERVICE", "CHOWN"]',
    "    cap_drop: [SYS_ADMIN]",
  ])
    assert.deepEqual(ids("k8s/api.yaml", line), [], line);
  assert.deepEqual(ids("config/app.yaml", "  add: [SYS_ADMIN]"), []);
});
