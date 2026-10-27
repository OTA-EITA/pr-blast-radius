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

test("host namespaces and host ports", () => {
  assert.deepEqual(ids("k8s/ds.yaml", "      hostIPC: true"), ["privileged-pod"]);
  assert.deepEqual(ids("k8s/ds.yaml", "      hostIPC: false"), []);
  assert.deepEqual(ids("k8s/ds.yaml", "              hostPort: 8080"), ["host-port"]);
  assert.deepEqual(ids("k8s/ds.yaml", "              hostPort: 0"), []);
  assert.deepEqual(ids("k8s/ds.yaml", "              containerPort: 8080"), []);
});

test("every S3 public access block flag and public GCP members", () => {
  for (const line of [
    "  ignore_public_acls      = false",
    "  restrict_public_buckets = false",
    "  block_public_policy     = false",
    '  member = "allUsers"',
    '  members = ["allAuthenticatedUsers"]',
  ])
    assert.deepEqual(ids("infra/storage.tf", line), ["public-resource"], line);
  for (const line of ["  restrict_public_buckets = true", '  member = "user:ops@example.com"'])
    assert.deepEqual(ids("infra/storage.tf", line), [], line);
});

test("secrets: inherit passes every secret to a reusable workflow", () => {
  assert.deepEqual(ids(".github/workflows/release.yml", "    secrets: inherit"), ["secrets-inherit"]);
  assert.deepEqual(ids(".github/workflows/release.yml", "    secrets:"), []);
  assert.deepEqual(ids("docs/secrets.yml", "    secrets: inherit"), []);
});

test("third-party actions not pinned to a commit SHA", () => {
  const wf = ".github/workflows/ci.yml";
  for (const line of [
    "      - uses: some-org/setup-thing@v2",
    "      - uses: 'some-org/setup-thing@main'",
    "    uses: octo-org/shared/.github/workflows/build.yml@main",
    "      - uses: some-org/setup-thing@a0853c2 # short SHA",
  ])
    assert.deepEqual(ids(wf, line), ["unpinned-action"], line);
  for (const line of [
    "      - uses: some-org/setup-thing@a0853c24544627f65ddf259abe73b1d18a591444 # v2",
    "      - uses: actions/checkout@v5",
    "      - uses: github/codeql-action/init@v3",
    "      - uses: ./.github/actions/build",
    "      - uses: docker://alpine:3.20",
  ])
    assert.deepEqual(ids(wf, line), [], line);
  assert.deepEqual(ids("action.yml", "    - uses: some-org/setup-thing@v2"), ["unpinned-action"]);
});

test("a downloaded script piped straight into a shell", () => {
  for (const [file, line] of [
    ["Dockerfile", "RUN curl -fsSL https://get.example.com/install.sh | sh"],
    ["Dockerfile", "RUN wget -qO- https://example.com/setup | sudo -E bash -s -- --yes"],
    [".github/workflows/ci.yml", "        run: curl -sSL https://example.com/i.sh | bash"],
  ])
    assert.deepEqual(ids(file, line), ["pipe-to-shell"], line);
  for (const line of [
    "RUN curl -fsSLo app.tgz https://example.com/app.tgz && sha256sum -c app.sha256",
    "RUN curl -fsSL https://example.com/app.tgz | tar xz",
    "RUN curl -fsSL https://example.com/app.tgz | shasum -a 256",
  ])
    assert.deepEqual(ids("Dockerfile", line), [], line);
  assert.deepEqual(ids("scripts/setup.sh", "curl -fsSL https://x | sh"), []);
});

test("ADD of a remote URL without a checksum", () => {
  assert.deepEqual(ids("Dockerfile", "ADD https://example.com/tool.tgz /opt/"), ["remote-add"]);
  assert.deepEqual(ids("api.dockerfile", "add --chown=app http://example.com/x /x"), ["remote-add"]);
  for (const line of [
    "ADD --checksum=sha256:24454f830cdb571e2c4ad15481119c43b3cafd48dd869a9b2945d1036d1dc68d https://example.com/tool.tgz /opt/",
    "ADD ./tool.tgz /opt/",
  ])
    assert.deepEqual(ids("Dockerfile", line), [], line);
});

test("CloudFormation: public resources and turned-off protection", () => {
  for (const line of [
    "      PubliclyAccessible: true",
    '      "PubliclyAccessible": "true",',
    "        RestrictPublicBuckets: false",
    "      MapPublicIpOnLaunch: true",
    "      AccessControl: PublicReadWrite",
  ])
    assert.deepEqual(ids("template.yaml", line), ["public-resource"], line);
  assert.deepEqual(ids("template.yaml", "      DeletionProtection: false"), ["protection-disabled"]);
  assert.deepEqual(ids("template.yaml", "      DeletionProtectionEnabled: false"), ["protection-disabled"]);
  assert.deepEqual(ids("template.yaml", "    DeletionPolicy: Retain", "-"), ["protection-removed"]);
  assert.deepEqual(ids("template.yaml", "      PubliclyAccessible: false"), []);
  assert.deepEqual(ids("template.yaml", "    DeletionPolicy: Retain"), []);
  assert.deepEqual(ids("k8s/api.yaml", "      PubliclyAccessible: true"), []);
});

test("CloudFormation: flipping DeletionProtection is reported once", () => {
  const r = analyze([
    {
      filename: "template.yaml",
      status: "modified",
      patch: "@@ -8,1 +8,1 @@\n-      DeletionProtection: true\n+      DeletionProtection: false",
    },
  ]);
  assert.deepEqual(
    r.findings.map((f) => `${f.id}:${String(f.line)}`),
    ["protection-disabled:8"],
  );
});
