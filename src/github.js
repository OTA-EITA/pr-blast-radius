/**
 * Minimal GitHub REST client for what the action needs.
 * `fetchImpl` is injectable so tests run without the network.
 */
export class GitHub {
  /**
   * @param {{ token: string, repo: string, apiUrl?: string, fetchImpl?: typeof fetch }} opt
   */
  constructor(opt) {
    this.token = opt.token;
    this.repo = opt.repo;
    this.api = (opt.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.fetch = opt.fetchImpl ?? fetch;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async request(method, path, body) {
    /** @type {RequestInit} */
    const init = {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "pr-blast-radius",
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      /** @type {Record<string, string>} */ (init.headers)["content-type"] = "application/json";
    }
    const res = await this.fetch(`${this.api}/repos/${this.repo}${path}`, init);
    if (!res.ok) {
      const err = new Error(`${method} ${path}: HTTP ${String(res.status)}`);
      Object.assign(err, { status: res.status });
      throw err;
    }
    return res.status === 204 ? undefined : res.json();
  }

  /**
   * Every file in the pull request. The API returns at most 3000 files.
   * @param {number} pr
   * @returns {Promise<import("./analyze.js").ChangedFile[]>}
   */
  async files(pr) {
    /** @type {import("./analyze.js").ChangedFile[]} */
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const batch = /** @type {import("./analyze.js").ChangedFile[]} */ (
        await this.request("GET", `/pulls/${String(pr)}/files?per_page=100&page=${String(page)}`)
      );
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  /**
   * Creates the comment, or updates the one that carries the marker.
   * @param {number} pr
   * @param {string} body
   * @param {string} marker
   * @returns {Promise<"created" | "updated">}
   */
  async upsertComment(pr, body, marker) {
    for (let page = 1; page <= 10; page++) {
      const comments = /** @type {{ id: number, body?: string }[]} */ (
        await this.request("GET", `/issues/${String(pr)}/comments?per_page=100&page=${String(page)}`)
      );
      const mine = comments.find((c) => c.body?.startsWith(marker));
      if (mine) {
        await this.request("PATCH", `/issues/comments/${String(mine.id)}`, { body });
        return "updated";
      }
      if (comments.length < 100) break;
    }
    await this.request("POST", `/issues/${String(pr)}/comments`, { body });
    return "created";
  }

  /**
   * Sets one label from a family (e.g. risk:high) and removes its siblings.
   * @param {number} pr
   * @param {string} label
   * @param {string[]} family
   */
  async setLabel(pr, label, family) {
    for (const other of family.filter((l) => l !== label)) {
      try {
        await this.request("DELETE", `/issues/${String(pr)}/labels/${encodeURIComponent(other)}`);
      } catch (err) {
        if (/** @type {{ status?: number }} */ (err).status !== 404) throw err;
      }
    }
    await this.request("POST", `/issues/${String(pr)}/labels`, { labels: [label] });
  }
}
