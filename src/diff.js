/**
 * @typedef {object} DiffLine
 * @property {"+" | "-"} op   Added or removed.
 * @property {number} line    Line number in the new file (added) or the old file (removed).
 * @property {string} text    The line without its +/- prefix.
 */

/**
 * Splits a unified diff (the `patch` field of the GitHub pull request files API)
 * into added and removed lines with their line numbers.
 *
 * @param {string | undefined} patch
 * @returns {DiffLine[]}
 */
export function parsePatch(patch) {
  /** @type {DiffLine[]} */
  const out = [];
  if (!patch) return out;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ op: "+", line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-")) {
      out.push({ op: "-", line: oldLine, text: raw.slice(1) });
      oldLine++;
    } else if (!raw.startsWith("\\")) {
      // Context line ("\ No newline at end of file" belongs to neither side).
      oldLine++;
      newLine++;
    }
  }
  return out;
}
