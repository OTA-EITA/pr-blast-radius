/**
 * @typedef {"high" | "medium" | "low"} Risk
 *
 * @typedef {object} Area
 * @property {string} id
 * @property {string} title
 * @property {Risk} risk     Risk of touching the area at all.
 * @property {RegExp} path
 *
 * @typedef {object} Signal
 * @property {string} id
 * @property {Risk} risk
 * @property {string[]} areas    Areas the signal applies to; empty means any file.
 * @property {"+" | "-"} op      Look at added or removed lines.
 * @property {RegExp} pattern
 * @property {string} message
 */

/** First match wins, so more specific areas come first. @type {Area[]} */
export const areas = [
  {
    id: "secrets",
    title: "Possible secret files",
    risk: "high",
    path: /(^|\/)(\.env(\..+)?|.+\.(pem|key|p12|pfx))$/,
  },
  {
    id: "workflows",
    title: "CI/CD workflows",
    risk: "medium",
    path: /^\.github\/(workflows\/.+\.ya?ml|actions\/.+)$|(^|\/)action\.ya?ml$/,
  },
  {
    id: "access",
    title: "Ownership and repository rules",
    risk: "medium",
    path: /(^|\/)(CODEOWNERS|\.github\/settings\.ya?ml)$/,
  },
  { id: "terraform", title: "Terraform", risk: "medium", path: /\.(tf|tfvars|hcl)$/ },
  {
    id: "kubernetes",
    title: "Kubernetes and Helm",
    risk: "medium",
    path: /(^|\/)(k8s|kubernetes|manifests|deploy|helm|charts|kustomize|overlays)\/.+\.ya?ml$|(^|\/)(kustomization|Chart|values(-[\w.-]+)?)\.ya?ml$/,
  },
  {
    id: "migrations",
    title: "Database migrations",
    risk: "medium",
    path: /(^|\/)(migrations?|migrate|db\/schema)\/|\.sql$/,
  },
  {
    id: "containers",
    title: "Container images",
    risk: "low",
    path: /(^|\/)(Dockerfile[\w.-]*|[\w.-]+\.dockerfile|(docker-)?compose[\w.-]*\.ya?ml)$/,
  },
  {
    id: "dependencies",
    title: "Dependencies",
    risk: "low",
    path: /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|requirements[\w.-]*\.txt|poetry\.lock|Pipfile(\.lock)?|Gemfile(\.lock)?|composer\.(json|lock)|Cargo\.(toml|lock))$/,
  },
];

/** @type {Signal[]} */
export const signals = [
  // IAM and access
  {
    id: "iam-wildcard-action",
    risk: "high",
    areas: [],
    op: "+",
    pattern: /["']?actions?["']?\s*[:=]\s*\[?\s*["']\*["']|"Action"\s*:\s*"\*"|["'][a-z0-9-]+:\*["']/i,
    message: "IAM policy allows every action (*)",
  },
  {
    id: "iam-wildcard-principal",
    risk: "high",
    areas: [],
    op: "+",
    pattern: /"?Principal"?\s*[:=]\s*(\{\s*"AWS"\s*:\s*)?"\*"|identifiers\s*=\s*\[\s*"\*"\s*\]/i,
    message: "Policy trusts any principal (*)",
  },
  {
    id: "admin-policy",
    risk: "high",
    areas: [],
    op: "+",
    pattern: /AdministratorAccess|roles\/owner|cluster-admin/,
    message: "Grants an administrator role",
  },
  {
    id: "cluster-role",
    risk: "medium",
    areas: ["kubernetes"],
    op: "+",
    pattern: /kind:\s*ClusterRole(Binding)?\b/,
    message: "Changes cluster-wide RBAC",
  },
  // Network exposure
  {
    id: "open-to-internet",
    risk: "high",
    areas: [],
    op: "+",
    pattern: /0\.0\.0\.0\/0|::\/0/,
    message: "Opens access to the whole internet",
  },
  {
    id: "public-resource",
    risk: "high",
    areas: ["terraform"],
    op: "+",
    pattern:
      /publicly_accessible\s*=\s*true|acl\s*=\s*"public-read|(block_public_(acls|policy)|ignore_public_acls|restrict_public_buckets)\s*=\s*false|map_public_ip_on_launch\s*=\s*true|"all(Authenticated)?Users"/,
    message: "Makes a resource publicly reachable",
  },
  {
    id: "load-balancer-service",
    risk: "medium",
    areas: ["kubernetes"],
    op: "+",
    pattern: /type:\s*(LoadBalancer|NodePort)\b/,
    message: "Exposes a Service outside the cluster",
  },
  {
    id: "host-port",
    risk: "medium",
    areas: ["kubernetes"],
    op: "+",
    pattern: /hostPort:\s*["']?[1-9]/,
    message: "Binds a container port on the node itself",
  },
  // Data loss
  {
    id: "protection-disabled",
    risk: "high",
    areas: ["terraform"],
    op: "+",
    pattern:
      /(deletion_protection|prevent_destroy)\s*=\s*false|skip_final_snapshot\s*=\s*true|force_destroy\s*=\s*true/,
    message: "Turns off protection against deleting data",
  },
  {
    id: "protection-removed",
    risk: "high",
    areas: ["terraform"],
    op: "-",
    pattern: /(deletion_protection|prevent_destroy)\s*=\s*true/,
    message: "Removes protection against deleting data",
  },
  {
    id: "destructive-sql",
    risk: "high",
    areas: ["migrations"],
    op: "+",
    pattern: /\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCATE\b|ALTER\s+TABLE\s+\S+\s+DROP\b)/i,
    message: "Drops or truncates data",
  },
  // Workloads
  {
    id: "privileged-pod",
    risk: "high",
    areas: ["kubernetes"],
    op: "+",
    pattern:
      /privileged:\s*true|allowPrivilegeEscalation:\s*true|host(Network|PID|IPC):\s*true|hostPath:/,
    message: "Gives a workload access to the node",
  },
  {
    // Outside the Pod Security Standards baseline list. A bare "- ALL" is not matched:
    // it is far more often under drop than under add.
    id: "dangerous-capability",
    risk: "high",
    areas: ["kubernetes", "containers"],
    op: "+",
    pattern:
      /\b(cap_)?add:\s*\[[^\]]*\b(ALL|(CAP_)?(SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|SYS_RAWIO|DAC_READ_SEARCH|BPF))\b|^\s*-\s*["']?(CAP_)?(SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|SYS_RAWIO|DAC_READ_SEARCH|BPF)["']?\s*$/,
    message: "Adds a Linux capability that gives a container control over the node",
  },
  {
    id: "root-container",
    risk: "medium",
    areas: ["containers", "kubernetes"],
    op: "+",
    pattern: /^\s*USER\s+(root|0)\s*$|runAsUser:\s*0\b|runAsNonRoot:\s*false/,
    message: "Runs a container as root",
  },
  {
    id: "latest-tag",
    risk: "low",
    areas: ["containers", "kubernetes"],
    op: "+",
    pattern: /(FROM|image:)\s*\S+:latest\b/,
    message: "Uses a mutable :latest image tag",
  },
  {
    id: "pipe-to-shell",
    risk: "medium",
    areas: ["containers", "workflows"],
    op: "+",
    pattern: /\b(curl|wget)\b[^|#]*\|\s*(sudo\s+(-\S+\s+)*)?(ba|z|da|k)?sh\b/,
    message: "Runs a downloaded script without checking what it is",
  },
  {
    // https://docs.docker.com/reference/dockerfile/#add---checksum
    id: "remote-add",
    risk: "low",
    areas: ["containers"],
    op: "+",
    pattern: /^\s*ADD\s+(?![^#]*--checksum=)(--\S+\s+)*["']?https?:\/\//i,
    message: "Downloads a remote file without pinning its checksum (ADD --checksum)",
  },
  // CI/CD
  {
    id: "pull-request-target",
    risk: "high",
    areas: ["workflows"],
    op: "+",
    pattern: /pull_request_target/,
    message: "Runs with secrets on pull requests from forks",
  },
  {
    id: "write-all",
    risk: "high",
    areas: ["workflows"],
    op: "+",
    pattern: /permissions:\s*write-all/,
    message: "Gives the workflow token every write permission",
  },
  {
    id: "token-write",
    risk: "medium",
    areas: ["workflows"],
    op: "+",
    pattern: /^\s*(contents|packages|actions|id-token|pull-requests|deployments|security-events):\s*write\b/,
    message: "Gives the workflow token a write permission",
  },
  {
    id: "secrets-inherit",
    risk: "medium",
    areas: ["workflows"],
    op: "+",
    pattern: /^\s*secrets:\s*inherit\b/,
    message: "Passes every repository secret to a reusable workflow",
  },
  {
    // GitHub's hardening guide: pin actions to a full-length commit SHA. actions/* and
    // github/* are left out to keep the noise down; local and docker:// steps have no ref.
    id: "unpinned-action",
    risk: "low",
    areas: ["workflows"],
    op: "+",
    pattern: /^\s*(-\s*)?uses:\s*["']?(?!\.|docker:|(actions|github)\/)[\w.-]+\/[^@\s"']+@(?![0-9a-f]{40}\b)/,
    message: "Uses a third-party action or workflow by a tag or branch, not a commit SHA",
  },
  {
    id: "secrets-in-workflow",
    risk: "low",
    areas: ["workflows"],
    op: "+",
    pattern: /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)/,
    message: "Uses a repository secret",
  },
];
