import assert from "node:assert/strict";
import { test } from "node:test";
import { matcher, parseList } from "../src/glob.js";

test("* stays inside one directory, ** crosses them", () => {
  const m = matcher(["vendor/**", "docs/*.md", "test/**/fixtures/**"]);
  assert.equal(m("vendor/a/b/c.tf"), true);
  assert.equal(m("docs/a.md"), true);
  assert.equal(m("docs/sub/a.md"), false);
  assert.equal(m("test/fixtures/k8s.yaml"), true);
  assert.equal(m("test/unit/x/fixtures/iam.json"), true);
  assert.equal(m("src/vendor/a.tf"), false);
  assert.equal(m("vendored/a.tf"), false);
});

test("a pattern without a slash matches the file name in any directory", () => {
  const m = matcher(["*.snap", "go.sum"]);
  assert.equal(m("a/b/__snapshots__/x.test.js.snap"), true);
  assert.equal(m("services/api/go.sum"), true);
  assert.equal(m("services/api/go.mod"), false);
});

test("a trailing slash means everything under the directory, a leading one is the root", () => {
  const m = matcher(["/examples/", "?.tf"]);
  assert.equal(m("examples/k8s/pod.yaml"), true);
  assert.equal(m("a/examples/pod.yaml"), false);
  assert.equal(m("x/a.tf"), true);
  assert.equal(m("x/ab.tf"), false);
});

test("regex characters in a pattern are literal", () => {
  const m = matcher(["a+b(c).tf", "[x].yaml"]);
  assert.equal(m("a+b(c).tf"), true);
  assert.equal(m("aab(c).tf"), false);
  assert.equal(m("[x].yaml"), true);
  assert.equal(m("x.yaml"), false);
});

test("no patterns match nothing", () => {
  assert.equal(matcher([])("anything"), false);
});

test("parses a newline or comma separated list with comments", () => {
  assert.deepEqual(parseList("vendor/**\n  docs/*.md , *.snap\n# generated\n\n"), [
    "vendor/**",
    "docs/*.md",
    "*.snap",
  ]);
  assert.deepEqual(parseList(""), []);
});
