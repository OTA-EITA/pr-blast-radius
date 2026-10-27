import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze } from "../src/analyze.js";
import { marker, renderComment } from "../src/report.js";

const files = JSON.parse(readFileSync(new URL("./fixtures/pr-files.json", import.meta.url), "utf8"));

test("renders areas and findings under the marker", () => {
  const md = renderComment(analyze(files));
  assert.ok(md.startsWith(`${marker}\n### Blast radius: 🔴 High`));
  assert.match(md, /\| 🟡 Terraform \| `infra\/rds\.tf`, `infra\/iam\.tf`, `infra\/old_queue\.tf` \|/);
  assert.match(
    md,
    /- 🔴 Opens access to the whole internet — `infra\/rds\.tf:34` `cidr_blocks = \["0\.0\.0\.0\/0"\]`/,
  );
  assert.match(md, /- 🟡 Deletes a Terraform file.* — `infra\/old_queue\.tf`\n/);
  assert.match(md, /8 file\(s\) changed/);
});

test("says so when nothing sensitive changed", () => {
  const md = renderComment(analyze([{ filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n+x" }]));
  assert.match(md, /🟢 Low\n\n1 file\(s\) changed\. No infrastructure, CI, access or data changes found\./);
});

test("keeps untrusted diff text inside code spans", () => {
  const md = renderComment({
    risk: "high",
    files: 1,
    areas: [],
    findings: [
      { id: "x", risk: "high", file: "a|b.tf", line: 1, message: "m", text: "`<img src=x>` | @here" },
    ],
  });
  assert.ok(md.includes("- 🔴 m — `a\\|b.tf:1` `` `<img src=x>` \\| @here ``"));
});

test("truncates long lists", () => {
  const many = Array.from({ length: 7 }, (_, i) => `k8s/f${String(i)}.yaml`);
  const r = {
    risk: /** @type {const} */ ("medium"),
    files: 7,
    areas: [
      { id: "kubernetes", title: "Kubernetes and Helm", risk: /** @type {const} */ ("medium"), files: many },
    ],
    findings: [],
  };
  assert.match(renderComment(r), /and 2 more \|/);
  const findings = Array.from({ length: 3 }, (_, i) => ({
    id: "x",
    risk: /** @type {const} */ ("low"),
    file: `f${String(i)}`,
    line: 1,
    message: "m",
    text: "",
  }));
  assert.match(
    renderComment({ risk: "low", files: 3, areas: [], findings }, { maxFindings: 2 }),
    /…and 1 more/,
  );
});

test("a run of backticks or a carriage return cannot close the code span", () => {
  const md = renderComment({
    risk: "high",
    files: 1,
    areas: [{ id: "terraform", title: "Terraform", risk: "medium", files: ["x\r| [a](b) |.tf"] }],
    findings: [
      { id: "x", risk: "high", file: "a.tf", line: 2, message: "m", text: "a `` [click](https://evil) ``` @here" },
    ],
  });
  assert.ok(md.includes("- 🔴 m — `a.tf:2` ```` a `` [click](https://evil) ``` @here ````\n"));
  assert.ok(md.includes("| 🟡 Terraform | `x \\| [a](b) \\|.tf` |\n"));
  assert.doesNotMatch(md, /\r/);
});
