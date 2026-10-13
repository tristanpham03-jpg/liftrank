import type { Exercise } from "./types";

/**
 * Client-side exercise search over the preloaded catalog. Rules:
 *  - case-insensitive, punctuation-insensitive ("pull-up" = "pull up" = "pullup" via aliases)
 *  - exact alias/name wins ("rdl", "ohp")
 *  - every query word must start a word in the name or an alias ("incl smith", "lat pull")
 *  - substring fallback, then a typo-tolerant fallback ("benhc press")
 */

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/ /g, "");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of y) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (x.length + y.length);
}

function wordPrefixMatch(tokens: string[], text: string): boolean {
  const words = text.split(" ");
  return tokens.every((t) => words.some((w) => w.startsWith(t)));
}

export function scoreExercise(ex: Pick<Exercise, "name" | "aliases">, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = q.split(" ");
  const name = normalize(ex.name);
  const aliases = ex.aliases.map(normalize);
  const texts = [name, ...aliases];

  if (texts.includes(q)) return 100;
  if (name.startsWith(q)) return 85;
  if (aliases.some((a) => a.startsWith(q))) return 75;
  if (wordPrefixMatch(tokens, name)) return 65;
  if (aliases.some((a) => wordPrefixMatch(tokens, a))) return 60;
  if (texts.some((t) => t.includes(q) || t.replace(/ /g, "").includes(q.replace(/ /g, "")))) return 45;
  const best = Math.max(...texts.map((t) => similarity(q, t)));
  return best >= 0.55 ? Math.round(20 + best * 20) : 0;
}

export function searchExercises<T extends Pick<Exercise, "name" | "aliases" | "popular_rank">>(
  catalog: T[],
  query: string,
  limit = 20,
): T[] {
  return catalog
    .map((ex) => ({ ex, s: scoreExercise(ex, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.ex.popular_rank - b.ex.popular_rank || a.ex.name.localeCompare(b.ex.name))
    .slice(0, limit)
    .map((r) => r.ex);
}
