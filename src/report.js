/** Hidden marker that identifies this action's comment so it can be updated in place. */
export const marker = "<!-- pr-blast-radius -->";

/** @type {Record<import("./rules.js").Risk, string>} */
const badge = { high: "🔴 High", medium: "🟡 Medium", low: "🟢 Low" };

/** Text from the diff is untrusted: keep it inside inline code and out of table syntax. @param {string} s */
function code(s) {
  const clean = s.replaceAll("|", "\\|").replaceAll("\n", " ");
  return clean.includes("`") ? `\`\` ${clean} \`\`` : `\`${clean}\``;
}

/**
 * @param {import("./analyze.js").Result} r
 * @param {{ maxFindings?: number }} [opt]
 */
export function renderComment(r, opt = {}) {
  const max = opt.maxFindings ?? 30;
  const out = [marker, `### Blast radius: ${badge[r.risk]}`, ""];

  if (!r.areas.length && !r.findings.length) {
    out.push(`${String(r.files)} file(s) changed. No infrastructure, CI, access or data changes found.`);
    return out.join("\n") + "\n";
  }

  if (r.areas.length) {
    out.push("| Area | Files |", "|---|---|");
    for (const a of r.areas) {
      const shown = a.files.slice(0, 5).map(code).join(", ");
      const more = a.files.length > 5 ? ` and ${String(a.files.length - 5)} more` : "";
      out.push(`| ${badge[a.risk].split(" ")[0] ?? ""} ${a.title} | ${shown}${more} |`);
    }
    out.push("");
  }

  if (r.findings.length) {
    out.push("**Worth a closer look**", "");
    for (const f of r.findings.slice(0, max)) {
      const where = f.line ? `${f.file}:${String(f.line)}` : f.file;
      out.push(
        `- ${badge[f.risk].split(" ")[0] ?? ""} ${f.message} — ${code(where)}${f.text ? ` ${code(f.text)}` : ""}`,
      );
    }
    if (r.findings.length > max) out.push(`- …and ${String(r.findings.length - max)} more`);
    out.push("");
  }

  out.push(
    `<sub>${String(r.files)} file(s) changed · [pr-blast-radius](https://github.com/OTA-EITA/pr-blast-radius) reads the diff only and never runs the pull request's code</sub>`,
  );
  return out.join("\n") + "\n";
}
