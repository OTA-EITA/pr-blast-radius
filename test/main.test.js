import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { run } from "../src/main.js";
import { fakeFetch } from "./fake.js";

const prFiles = JSON.parse(readFileSync(new URL("./fixtures/pr-files.json", import.meta.url), "utf8"));
const base = "/repos/acme/app";

/** @param {Record<string, string>} inputs @param {Parameters<typeof fakeFetch>[0]} routes @param {object} [event] */
function setup(inputs = {}, routes = {}, event = { pull_request: { number: 7 } }) {
  const dir = mkdtempSync(path.join(tmpdir(), "pbr-"));
  const eventPath = path.join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  for (const f of ["summary", "output"]) writeFileSync(path.join(dir, f), "");
  const f = fakeFetch({
    [`GET ${base}/pulls/7/files`]: () => ({ body: prFiles }),
    [`GET ${base}/issues/7/comments`]: () => ({ body: [] }),
    [`POST ${base}/issues/7/comments`]: () => ({ status: 201, body: {} }),
    [`DELETE ${base}/issues/7/labels/risk%3Alow`]: () => ({ status: 404 }),
    [`DELETE ${base}/issues/7/labels/risk%3Amedium`]: () => ({ status: 404 }),
    [`POST ${base}/issues/7/labels`]: () => ({ body: [] }),
    ...routes,
  });
  /** @type {Record<string, string>} */
  const env = {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_API_URL: "https://api.example.com",
    GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
    GITHUB_OUTPUT: path.join(dir, "output"),
    INPUT_TOKEN: "t",
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  let log = "";
  const go = () => run({ env, log: (s) => (log += s), fetchImpl: f.fetch });
  return { go, f, dir, log: () => log };
}

test("comments, labels and writes outputs", async () => {
  const s = setup();
  assert.equal(await s.go(), 0);
  const post = s.f.calls.find((c) => c.method === "POST" && c.path.endsWith("/comments"));
  assert.match(
    String(/** @type {any} */ (post?.body).body),
    /^<!-- pr-blast-radius -->\n### Blast radius: 🔴 High/,
  );
  assert.deepEqual(s.f.calls.at(-1)?.body, { labels: ["risk:high"] });
  assert.equal(
    readFileSync(path.join(s.dir, "output"), "utf8"),
    "risk=high\nareas=workflows,migrations,kubernetes,terraform,dependencies\nfindings=10\n",
  );
  assert.match(readFileSync(path.join(s.dir, "summary"), "utf8"), /Blast radius/);
  assert.match(
    s.log(),
    /::warning file=infra\/rds\.tf,line=34,title=open-to-internet::Opens access to the whole internet/,
  );
  assert.match(s.log(), /blast radius: high \(5 area\(s\), 10 finding\(s\)\)/);
});

test("fail-on turns a risk into a failing check", async () => {
  assert.equal(await setup({ "fail-on": "high" }).go(), 1);
  assert.equal(await setup({ "fail-on": "none" }).go(), 0);
  await assert.rejects(setup({ "fail-on": "critical" }).go(), /fail-on must be/);
});

test("a read-only token (fork) warns instead of failing", async () => {
  const s = setup(
    {},
    {
      [`POST ${base}/issues/7/comments`]: () => ({ status: 403 }),
      [`POST ${base}/issues/7/labels`]: () => ({ status: 403 }),
    },
  );
  assert.equal(await s.go(), 0);
  assert.match(s.log(), /could not comment \(HTTP 403\)/);
  assert.match(s.log(), /could not set the label \(HTTP 403\)/);
});

test("other API errors fail the run", async () => {
  await assert.rejects(
    setup({}, { [`POST ${base}/issues/7/comments`]: () => ({ status: 500 }) }).go(),
    /HTTP 500/,
  );
});

test("comment and label can be turned off, label prefix changed", async () => {
  const s = setup(
    { comment: "false", "label-prefix": "blast:" },
    {
      [`DELETE ${base}/issues/7/labels/blast%3Alow`]: () => ({ status: 404 }),
      [`DELETE ${base}/issues/7/labels/blast%3Amedium`]: () => ({ status: 404 }),
    },
  );
  await s.go();
  assert.equal(
    s.f.calls.some((c) => c.path.includes("/comments")),
    false,
  );
  assert.deepEqual(s.f.calls.at(-1)?.body, { labels: ["blast:high"] });
  const off = setup({ comment: "false", label: "false" });
  await off.go();
  assert.deepEqual(
    off.f.calls.map((c) => c.method),
    ["GET"],
  );
});

test("does nothing outside pull request events", async () => {
  const s = setup({}, {}, { ref: "refs/heads/main" });
  assert.equal(await s.go(), 0);
  assert.equal(s.f.calls.length, 0);
  assert.match(s.log(), /runs on pull_request events/);
});
