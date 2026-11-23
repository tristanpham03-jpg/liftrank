/**
 * A same-site path to go to after signing in, or `fallback`. Browsers strip tabs and newlines from URLs and
 * treat "\\" like "/", so "/<tab>/evil.com" or "/\\evil.com" would become "//evil.com" (another site): any
 * whitespace, control character or backslash is refused, and the path must resolve to this origin.
 */
export function safeNext(next: string | null | undefined, fallback = "/training") {
  if (!next || next.length > 512 || !next.startsWith("/") || /[\s\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "https://sblift.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
