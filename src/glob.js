/**
 * Small glob matcher for the ignore-paths input, matched against repository-relative paths.
 *
 * - `*` matches within one directory, `?` one character, `**` any number of directories.
 * - A pattern without a slash matches the file name in any directory (`*.snap`).
 * - A trailing slash means everything under the directory (`vendor/` is `vendor/**`).
 * - A leading slash is the repository root and is otherwise ignored.
 *
 * @param {string} glob
 */
function toRegExp(glob) {
  let g = glob.startsWith("/") ? glob.slice(1) : glob;
  if (g.endsWith("/")) g += "**";
  const anywhere = !glob.startsWith("/") && !g.includes("/");
  let body = "";
  for (let i = 0; i < g.length; i++) {
    const c = /** @type {string} */ (g[i]);
    if (g.startsWith("**/", i)) {
      body += "(?:.*/)?";
      i += 2;
    } else if (g.startsWith("**", i)) {
      body += ".*";
      i += 1;
    } else if (c === "*") body += "[^/]*";
    else if (c === "?") body += "[^/]";
    else body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${anywhere ? "(?:^|/)" : "^"}${body}$`);
}

/**
 * @param {string[]} globs
 * @returns {(path: string) => boolean}
 */
export function matcher(globs) {
  const res = globs.map(toRegExp);
  return (path) => res.some((re) => re.test(path));
}

/**
 * Splits an action input on newlines and commas, dropping blanks and `#` comments.
 * @param {string} s
 */
export function parseList(s) {
  return s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
}
