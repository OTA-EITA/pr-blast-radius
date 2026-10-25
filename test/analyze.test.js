import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze, areaOf } from "../src/analyze.js";

const files = JSON.parse(readFileSync(new URL("./fixtures/pr-files.json", import.meta.url), "utf8"));
/** @param {string} filename @param {string} patch */
const one = (filename, patch, status = "modified") => analyze([{ filename, status, patch }]);

test("finds every risky change in the fixture with its line", () => {
  const r = analyze(files);
  assert.equal(r.risk, "high");
  assert.equal(r.files, 8);
  assert.deepEqual(
    r.findings.map((f) => `${f.risk} ${f.id} ${f.file}:${String(f.line)}`),
    [
      "high pull-request-target .github/workflows/deploy.yml:2",
      "high destructive-sql db/migrations/20261025_drop_legacy.sql:1",
      "high privileged-pod deploy/k8s/api.yaml:24",
      "high iam-wildcard-action infra/iam.tf:3",
      "high protection-disabled infra/rds.tf:12",
      "high open-to-internet infra/rds.tf:34",
      "medium token-write .github/workflows/deploy.yml:4",
      "medium terraform-file-removed infra/old_queue.tf:0",
      "low latest-tag deploy/k8s/api.yaml:22",
    ],
  );
  assert.deepEqual(
    r.areas.map((a) => `${a.id}:${String(a.files.length)}`),
    ["workflows:1", "migrations:1", "kubernetes:1", "terraform:3", "dependencies:1"],
  );
});

test("reports a removed protection flag when it is not replaced by false", () => {
  const r = one("infra/db.tf", '@@ -5,2 +5,1 @@\n-  deletion_protection = true\n   engine = "postgres"');
  assert.deepEqual(
    r.findings.map((f) => `${f.id}:${String(f.line)}`),
    ["protection-removed:5"],
  );
});

test("application code alone is low risk with no areas", () => {
  const r = one("src/app.ts", "@@ -1 +1 @@\n-a\n+b");
  assert.deepEqual([r.risk, r.areas, r.findings], ["low", [], []]);
});

test("classifies paths", () => {
  assert.equal(areaOf(".env.production")?.id, "secrets");
  assert.equal(areaOf("certs/server.key")?.id, "secrets");
  assert.equal(areaOf(".github/workflows/ci.yml")?.id, "workflows");
  assert.equal(areaOf("action.yml")?.id, "workflows");
  assert.equal(areaOf(".github/CODEOWNERS")?.id, "access");
  assert.equal(areaOf("charts/api/values-prod.yaml")?.id, "kubernetes");
  assert.equal(areaOf("overlays/prod/kustomization.yaml")?.id, "kubernetes");
  assert.equal(areaOf("docker/api.dockerfile")?.id, "containers");
  assert.equal(areaOf("compose.yaml")?.id, "containers");
  assert.equal(areaOf("services/go.sum")?.id, "dependencies");
  assert.equal(areaOf("docs/kubernetes.md"), undefined);
  assert.equal(areaOf("config/app.yaml"), undefined);
});

test("signals only apply to their areas", () => {
  // privileged: true in an app config is not a Kubernetes change
  assert.deepEqual(one("config/app.yaml", "@@ -0,0 +1 @@\n+privileged: true").findings, []);
  assert.equal(
    one("k8s/ds.yaml", "@@ -0,0 +1 @@\n+      hostNetwork: true").findings[0]?.id,
    "privileged-pod",
  );
});

test("area-independent signals fire anywhere", () => {
  const r = one("policies/ci.json", '@@ -0,0 +1 @@\n+{"Effect": "Allow", "Action": "*"}');
  assert.equal(r.findings[0]?.id, "iam-wildcard-action");
  assert.equal(r.risk, "high");
});

test("renamed files keep the area of their old path", () => {
  const r = analyze([{ filename: "x/main.tmp", previous_filename: "x/main.tf", status: "renamed" }]);
  assert.equal(r.areas[0]?.id, "terraform");
});

test("asks for manual review when GitHub omits a diff in a sensitive area", () => {
  const r = analyze([{ filename: "k8s/huge.yaml", status: "modified" }]);
  assert.equal(r.findings[0]?.id, "diff-unavailable");
  assert.deepEqual(analyze([{ filename: "yarn.lock", status: "modified" }]).findings, []);
});

test("does not flag secrets.GITHUB_TOKEN", () => {
  const ids = (/** @type {string} */ line) =>
    one(".github/workflows/x.yml", `@@ -0,0 +1 @@\n+${line}`).findings.map((f) => f.id);
  assert.deepEqual(ids("token: ${{ secrets.GITHUB_TOKEN }}"), []);
  assert.deepEqual(ids("token: ${{ secrets.DEPLOY_KEY }}"), ["secrets-in-workflow"]);
});
