/**
 * A fake fetch that answers from a route table and records every request.
 * @param {Record<string, (init: RequestInit, url: URL) => { status?: number, body?: unknown }>} routes  "METHOD /path" -> handler
 */
export function fakeFetch(routes) {
  /** @type {{ method: string, path: string, body: unknown }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fn = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      path: url.pathname + url.search,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const handler = routes[key];
    const res = handler ? handler(init, url) : { status: 404 };
    const status = res.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), { status });
  };
  return { fetch: fn, calls };
}
