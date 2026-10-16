import { CATEGORY_WORDS, EQUIPMENT_WORDS, EXERCISE_MUSCLES, MUSCLE_WORDS, type Muscle } from "./exercise-muscles";
import type { Exercise } from "./types";

/**
 * Client-side exercise search over the preloaded catalog, used by every
 * exercise picker. Case- and punctuation-insensitive. Ranking:
 *  1. exact name or alias ("rdl", "ohp", "sldl")
 *  2. name / alias prefix, whole word, then every word starting a word ("incl smith")
 *  3. primary muscle ("tricep" → Skull Crusher), 4. secondary muscle,
 *  5. equipment, category or muscle group ("cable", "core")
 *  6. a typo-tolerant fallback ("benhc press")
 * Multi-word queries need every word to match something ("cable bicep").
 */

type Searchable = Pick<Exercise, "name" | "aliases"> &
  Partial<Pick<Exercise, "slug" | "category" | "equipment_type" | "muscle_group" | "primary_muscles" | "secondary_muscles">>;

/** "triceps" → "tricep", "calves" stays matched through MUSCLE_WORDS. */
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const lookup = <T>(map: Record<string, T[]>, w: string): T[] => map[w] ?? map[singular(w)] ?? map[`${w}s`] ?? [];

/** Muscles named in free text (database muscle lists, muscle_group). */
function musclesIn(texts: string[]): Set<Muscle> {
  const out = new Set<Muscle>();
  for (const text of texts) for (const w of normalize(text).split(" ")) for (const m of MUSCLE_WORDS[w] ?? []) if (w !== "upper" && w !== "front" && w !== "side" && w !== "rear") out.add(m);
  return out;
}

function tagsFor(ex: Searchable): { primary: Set<Muscle>; secondary: Set<Muscle>; group: Set<Muscle>; named: Set<Muscle> } {
  const known = ex.slug ? EXERCISE_MUSCLES[ex.slug] : undefined;
  return {
    named: musclesIn([ex.name]),
    primary: new Set(known?.primary ?? musclesIn(ex.primary_muscles ?? [])),
    secondary: new Set(known?.secondary ?? musclesIn(ex.secondary_muscles ?? [])),
    group: musclesIn([ex.muscle_group ?? ""]),
  };
}

/** How well one query word matches by muscle, equipment or category (0 = not at all). */
function tokenScore(word: string, ex: Searchable, tags: ReturnType<typeof tagsFor>, nameWords: string[]): number {
  if (nameWords.some((w) => w.startsWith(word) || singular(w) === singular(word))) return 60;
  const muscles = lookup(MUSCLE_WORDS, word);
  // "tris" → Triceps Pushdown before Dip: the name itself names the muscle.
  if (muscles.some((m) => tags.primary.has(m) && tags.named.has(m))) return 50;
  if (muscles.some((m) => tags.primary.has(m))) return 40;
  if (muscles.some((m) => tags.secondary.has(m))) return 30;
  if (ex.equipment_type && lookup(EQUIPMENT_WORDS, word).includes(ex.equipment_type)) return 25;
  if (ex.category && lookup(CATEGORY_WORDS, word).includes(ex.category)) return 25;
  if (muscles.some((m) => tags.group.has(m))) return 25;
  return 0;
}

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

export function scoreExercise(ex: Searchable, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = q.split(" ");
  const name = normalize(ex.name);
  const aliases = ex.aliases.map(normalize);
  const texts = [name, ...aliases];
  const nameWords = name.split(" ");

  if (texts.includes(q)) return 100;
  // A whole word of the name ("lat" in Lat Pulldown, "tricep" ≈ Triceps) beats a mere prefix (Lateral).
  if (tokens.length === 1 && nameWords.some((w) => w === q || singular(w) === singular(q))) return 87;
  if (name.startsWith(q)) return 85;
  if (aliases.some((a) => a.startsWith(q))) return 75;
  if (wordPrefixMatch(tokens, name)) return 65;
  if (aliases.some((a) => wordPrefixMatch(tokens, a))) return 60;
  if (texts.some((t) => t.includes(q) || t.replace(/ /g, "").includes(q.replace(/ /g, "")))) return 45;

  // Muscles, equipment, category: every word has to match something.
  const tags = tagsFor(ex);
  const words = [...nameWords, ...aliases.flatMap((a) => a.split(" "))];
  const perToken = tokens.map((w) => tokenScore(w, ex, tags, words));
  if (perToken.every((x) => x > 0)) return Math.min(...perToken);

  const best = Math.max(...texts.map((t) => similarity(q, t)));
  return best >= 0.55 ? Math.round(10 + best * 10) : 0;
}

export function searchExercises<T extends Searchable & Pick<Exercise, "popular_rank">>(
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
