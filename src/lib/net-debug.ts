/**
 * Test-only network diagnostics (enabled by LR_NET_DEBUG=1 in
 * scripts/e2e-supabase.sh, never in production). Times every server-side fetch
 * (Supabase REST, RPC, Auth, Storage) and prints any request still open after
 * 5 s as a STALL line, so a hanging test can be traced to the exact call.
 * Logs method, host and path only: never headers, keys or bodies.
 */
type Open = { id: number; method: string; target: string; started: number; warned: boolean };

export function installNetDebug() {
  const g = globalThis as typeof globalThis & { __lrNetDebug?: boolean };
  if (g.__lrNetDebug) return;
  g.__lrNetDebug = true;
  const original = globalThis.fetch;
  const open = new Map<number, Open>();
  let next = 0;
  const describe = (input: RequestInfo | URL) => {
    try {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return `${u.host}${u.pathname}`;
    } catch {
      return "(unparsed url)";
    }
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req: Open = {
      id: ++next,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      target: describe(input),
      started: Date.now(),
      warned: false,
    };
    open.set(req.id, req);
    try {
      const res = await original(input, init);
      const ms = Date.now() - req.started;
      if (ms > 2000 || req.warned) console.log(`[net] #${req.id} ${req.method} ${req.target} → ${res.status} after ${ms} ms`);
      return res;
    } catch (e) {
      console.log(`[net] #${req.id} ${req.method} ${req.target} FAILED after ${Date.now() - req.started} ms: ${e instanceof Error ? e.message : e}`);
      throw e;
    } finally {
      open.delete(req.id);
    }
  };

  setInterval(() => {
    const now = Date.now();
    for (const r of open.values()) {
      if (now - r.started > 5000 && !r.warned) {
        r.warned = true;
        console.log(`[net] STALL #${r.id} ${r.method} ${r.target} open for ${now - r.started} ms (${open.size} open)`);
      }
    }
  }, 1000).unref();
  console.log("[net] diagnostics on: logging requests slower than 2 s and stalls over 5 s");
}
