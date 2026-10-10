/* Similarity search for short names ("Demo: CAB E 11.1"): forgiving of case,
   accents, word order, partial words and small typos, and it ranks the best
   match first. Small and dependency-free; the lists are a few dozen items. */

/** Lowercase words and numbers: accents removed, letters and digits split apart. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Edit distance counting an adjacent swap as one edit ("teh" to "the"). */
export function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** Typos are forgiven from 4 letters up: one edit up to 6 letters, two beyond. */
const typoBudget = (length: number) => (length < 4 ? 0 : length <= 6 ? 1 : 2);

/** How well one typed word matches one word of the name, 0 (no) to 1 (exact). */
function wordScore(query: string, word: string): number {
  if (word === query) return 1;
  if (word.startsWith(query)) return 0.9;
  if (query.length >= 2 && word.includes(query)) return 0.7;
  const budget = typoBudget(query.length);
  if (budget === 0) return 0;
  /* A typo in a word, or in the start of a longer word still being typed. */
  const distance = Math.min(
    editDistance(query, word),
    editDistance(query, word.slice(0, query.length)),
  );
  return distance <= budget ? 0.6 - 0.1 * distance : 0;
}

/** 0 when `name` does not match `query`; otherwise higher is more similar.
   Every typed word has to match some word of the name. */
export function similarity(name: string, query: string): number {
  const wanted = tokenize(query);
  if (wanted.length === 0) return 1;
  const words = tokenize(name);
  let total = 0;
  for (const typed of wanted) {
    const best = Math.max(0, ...words.map((word) => wordScore(typed, word)));
    if (best === 0) return 0;
    total += best;
  }
  /* Typing the name's words in its own order is the strongest signal. */
  const inOrder = words.join(' ').includes(wanted.join(' ')) ? 0.2 : 0;
  return total / wanted.length + inOrder;
}

/** The items that match `query`, best match first (ties keep their order). */
export function searchByName<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  if (tokenize(query).length === 0) return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      score: similarity(nameOf(item), query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
