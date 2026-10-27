import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { analyze, riskRank } from "./analyze.js";
import { GitHub } from "./github.js";
import { marker, renderComment } from "./report.js";

/**
 * @typedef {object} Deps
 * @property {Record<string, string | undefined>} env
 * @property {(s: string) => void} log
 * @property {typeof fetch} [fetchImpl]
 */

/** @param {Record<string, string | undefined>} env @param {string} name @param {string} fallback */
function input(env, name, fallback) {
  const v = env[`INPUT_${name.toUpperCase()}`];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
/** @param {string} s */
const escapeData = (s) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
/** Property values (file=...) also end at ":" and ",". @param {string} s */
const escapeProperty = (s) => escapeData(s).replaceAll(":", "%3A").replaceAll(",", "%2C");

/**
 * @param {Deps} deps
 * @returns {Promise<number>} exit code
 */
export async function run({ env, log, fetchImpl }) {
  const failOn = input(env, "fail-on", "none");
  if (failOn !== "none" && !(failOn in riskRank))
    throw new Error(`fail-on must be high, medium, low or none, got "${failOn}"`);
  const prefix = input(env, "label-prefix", "risk:");

  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pr = Number(event.pull_request?.number ?? event.number);
  if (!Number.isInteger(pr) || pr <= 0) {
    log("::warning::pr-blast-radius runs on pull_request events; nothing to do\n");
    return 0;
  }
  /** @type {ConstructorParameters<typeof GitHub>[0]} */
  const opt = { token: input(env, "token", ""), repo: env.GITHUB_REPOSITORY ?? "" };
  if (env.GITHUB_API_URL) opt.apiUrl = env.GITHUB_API_URL;
  if (fetchImpl) opt.fetchImpl = fetchImpl;
  const gh = new GitHub(opt);

  const result = analyze(await gh.files(pr));
  const body = renderComment(result);

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, body);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `risk=${result.risk}\nareas=${result.areas.map((a) => a.id).join(",")}\nfindings=${String(result.findings.length)}\n`,
    );
  }
  for (const f of result.findings.filter((x) => x.risk !== "low")) {
    const level = f.risk === "high" ? "warning" : "notice";
    const where = f.line ? `file=${escapeProperty(f.file)},line=${String(f.line)},` : "";
    log(`::${level} ${where}title=${f.id}::${escapeData(f.message)}\n`);
  }

  // Pull requests from forks get a read-only token: report there instead of failing.
  /** @param {string} what @param {() => Promise<unknown>} fn */
  const tryWrite = async (what, fn) => {
    try {
      await fn();
    } catch (err) {
      const status = /** @type {{ status?: number }} */ (err).status;
      if (status !== 403 && status !== 404) throw err;
      log(
        `::warning::could not ${what} (HTTP ${String(status)}); the token is probably read-only, as on pull requests from forks\n`,
      );
    }
  };
  if (input(env, "comment", "true") === "true")
    await tryWrite("comment", () => gh.upsertComment(pr, body, marker));
  if (input(env, "label", "true") === "true") {
    const family = ["low", "medium", "high"].map((r) => prefix + r);
    await tryWrite("set the label", () => gh.setLabel(pr, prefix + result.risk, family));
  }

  log(
    `blast radius: ${result.risk} (${String(result.areas.length)} area(s), ${String(result.findings.length)} finding(s))\n`,
  );
  return failOn !== "none" &&
    riskRank[result.risk] >= riskRank[/** @type {import("./rules.js").Risk} */ (failOn)]
    ? 1
    : 0;
}

/** @param {string | undefined} argv1 */
function isEntryPoint(argv1) {
  try {
    return argv1 !== undefined && pathToFileURL(realpathSync(argv1)).href === import.meta.url;
  } catch {
    return false;
  }
}

/* node:coverage ignore next 9 */
if (isEntryPoint(process.argv[1])) {
  run({ env: process.env, log: (s) => process.stdout.write(s) }).then(
    (code) => (process.exitCode = code),
    (err) => {
      process.stdout.write(`::error::${escapeData(String(err))}\n`);
      process.exitCode = 1;
    },
  );
}
