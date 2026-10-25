import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHub } from "../src/github.js";
import { fakeFetch } from "./fake.js";

const base = "/repos/acme/app";
/** @param {ReturnType<typeof fakeFetch>} f */
const client = (f) =>
  new GitHub({ token: "t", repo: "acme/app", apiUrl: "https://api.example.com/", fetchImpl: f.fetch });

test("pages through pull request files", async () => {
  const f = fakeFetch({
    [`GET ${base}/pulls/7/files`]: (_, url) => ({
      body: Array.from({ length: url.searchParams.get("page") === "1" ? 100 : 3 }, (_, i) => ({
        filename: `f${String(i)}`,
        status: "added",
      })),
    }),
  });
  assert.equal((await client(f).files(7)).length, 103);
  assert.deepEqual(
    f.calls.map((c) => c.path),
    [`${base}/pulls/7/files?per_page=100&page=1`, `${base}/pulls/7/files?per_page=100&page=2`],
  );
});

test("updates its own comment instead of adding another", async () => {
  const f = fakeFetch({
    [`GET ${base}/issues/7/comments`]: () => ({
      body: [
        { id: 1, body: "hi" },
        { id: 2, body: "<!-- m -->\nold" },
      ],
    }),
    [`PATCH ${base}/issues/comments/2`]: () => ({ body: {} }),
  });
  assert.equal(await client(f).upsertComment(7, "<!-- m -->\nnew", "<!-- m -->"), "updated");
  assert.deepEqual(f.calls.at(-1), {
    method: "PATCH",
    path: `${base}/issues/comments/2`,
    body: { body: "<!-- m -->\nnew" },
  });
});

test("creates the comment when there is none", async () => {
  const f = fakeFetch({
    [`GET ${base}/issues/7/comments`]: () => ({ body: [] }),
    [`POST ${base}/issues/7/comments`]: () => ({ status: 201, body: {} }),
  });
  assert.equal(await client(f).upsertComment(7, "x", "<!-- m -->"), "created");
});

test("swaps the risk label and tolerates labels that are not set", async () => {
  const f = fakeFetch({
    [`DELETE ${base}/issues/7/labels/risk%3Alow`]: () => ({ status: 404 }),
    [`DELETE ${base}/issues/7/labels/risk%3Amedium`]: () => ({ status: 200, body: [] }),
    [`POST ${base}/issues/7/labels`]: () => ({ body: [] }),
  });
  await client(f).setLabel(7, "risk:high", ["risk:low", "risk:medium", "risk:high"]);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["DELETE", "DELETE", "POST"],
  );
  assert.deepEqual(f.calls.at(-1)?.body, { labels: ["risk:high"] });
});

test("surfaces other errors with their status", async () => {
  const f = fakeFetch({ [`DELETE ${base}/issues/7/labels/a`]: () => ({ status: 500 }) });
  await assert.rejects(
    client(f).setLabel(7, "b", ["a", "b"]),
    (/** @type {any} */ err) => err.status === 500,
  );
  await assert.rejects(new GitHub({ token: "t", repo: "acme/app", fetchImpl: f.fetch }).files(1), /HTTP 404/);
});
