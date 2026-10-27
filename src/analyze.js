import { parsePatch } from "./diff.js";
import { areas, signals } from "./rules.js";

/**
 * @typedef {import("./rules.js").Risk} Risk
 *
 * @typedef {object} ChangedFile   Shape of the GitHub "list pull request files" API.
 * @property {string} filename
 * @property {string} status       added, removed, modified, renamed, copied, changed, unchanged
 * @property {string} [patch]      Missing for binary files and very large diffs.
 * @property {string} [previous_filename]
 *
 * @typedef {object} Finding
 * @property {string} id
 * @property {Risk} risk
 * @property {string} file
 * @property {number} line
 * @property {string} message
 * @property {string} text         The matching line, trimmed.
 *
 * @typedef {object} AreaResult
 * @property {string} id
 * @property {string} title
 * @property {Risk} risk
 * @property {string[]} files
 *
 * @typedef {object} Result
 * @property {Risk} risk
 * @property {AreaResult[]} areas
 * @property {Finding[]} findings
 * @property {number} files      Changed files, ignored ones included.
 * @property {number} [ignored]  Files left out by the ignore option.
 *
 * @typedef {object} Options
 * @property {(path: string) => boolean} [ignore]  Paths to leave out (a file moved across counts only if both paths match).
 */

/** @type {Record<Risk, number>} */
export const riskRank = { low: 1, medium: 2, high: 3 };

/** @param {Risk[]} risks @returns {Risk} */
function max(risks) {
  return risks.reduce((a, b) => (riskRank[b] > riskRank[a] ? b : a), /** @type {Risk} */ ("low"));
}

/** @param {string} path */
export function areaOf(path) {
  return areas.find((a) => a.path.test(path));
}

/**
 * @param {ChangedFile[]} files
 * @param {Options} [opt]
 * @returns {Result}
 */
export function analyze(files, opt = {}) {
  /** @type {Map<string, AreaResult>} */
  const touched = new Map();
  /** @type {Finding[]} */
  const findings = [];
  let ignored = 0;

  for (const f of files) {
    if (opt.ignore?.(f.filename) && (f.previous_filename === undefined || opt.ignore(f.previous_filename))) {
      ignored++;
      continue;
    }
    const area = areaOf(f.filename) ?? (f.previous_filename ? areaOf(f.previous_filename) : undefined);
    if (area) {
      const r = touched.get(area.id) ?? { id: area.id, title: area.title, risk: area.risk, files: [] };
      r.files.push(f.filename);
      touched.set(area.id, r);
    }

    if (area?.id === "terraform" && f.status === "removed") {
      findings.push({
        id: "terraform-file-removed",
        risk: "medium",
        file: f.filename,
        line: 0,
        message: "Deletes a Terraform file: its resources will be destroyed unless they moved",
        text: "",
      });
    }
    if (area && riskRank[area.risk] >= riskRank.medium && f.patch === undefined && f.status !== "removed") {
      findings.push({
        id: "diff-unavailable",
        risk: "medium",
        file: f.filename,
        line: 0,
        message: "GitHub did not include the diff (too large or binary): review it by hand",
        text: "",
      });
    }

    const lines = parsePatch(f.patch);
    for (const s of signals) {
      if (s.areas.length && !(area && s.areas.includes(area.id))) continue;
      const hit = lines.find((l) => l.op === s.op && s.pattern.test(l.text));
      if (hit)
        findings.push({
          id: s.id,
          risk: s.risk,
          file: f.filename,
          line: hit.line,
          message: s.message,
          text: hit.text.trim().slice(0, 160),
        });
    }
  }

  // Flipping a protection flag shows up as both "removed true" and "added false": keep one.
  const dropped = new Set(findings.filter((f) => f.id === "protection-disabled").map((f) => f.file));
  const kept = findings.filter((f) => !(f.id === "protection-removed" && dropped.has(f.file)));

  kept.sort((a, b) => riskRank[b.risk] - riskRank[a.risk] || a.file.localeCompare(b.file) || a.line - b.line);
  const areaList = [...touched.values()].sort(
    (a, b) => riskRank[b.risk] - riskRank[a.risk] || a.title.localeCompare(b.title),
  );
  return {
    risk: max([...areaList.map((a) => a.risk), ...kept.map((f) => f.risk)]),
    areas: areaList,
    findings: kept,
    files: files.length,
    ignored,
  };
}
