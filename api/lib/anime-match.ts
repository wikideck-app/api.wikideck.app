// Reconnaissance d'un même personnage d'anime présent dans AniList et dans Kitsu sous des noms différents.

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** « Gojou Satoru » et « Satoru Gojo » : mots triés, voyelles longues rapprochées (ou → o, uu → u, aa → a…) */
const long = (w: string) => w.replace(/ou/g, "o").replace(/oo/g, "o").replace(/uu/g, "u").replace(/aa/g, "a").replace(/ee/g, "e").replace(/ii/g, "i");

export const nameTokens = (name: string) => words(name);
export const nameKey = (name: string) => words(name).sort().join(" ");
export const nameKeyLoose = (name: string) => words(name).map(long).sort().join(" ");

// mots sans valeur pour comparer des titres d'œuvres
const STOP = new Set(["the", "a", "an", "of", "no", "wa", "to", "ni", "ga", "de", "la", "le", "les", "season", "part", "movie", "ova", "tv"]);
const seriesTokens = (s: string) => words(s).filter((w) => !STOP.has(w));

export type Side = { title: string; series: string | null };

/** les deux titres d'œuvre désignent-ils la même œuvre ? (égalité, inclusion ou grand recouvrement des mots) */
export function sameSeries(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = seriesTokens(a);
  const y = seriesTokens(b);
  if (!x.length || !y.length) return false;
  const sx = new Set(x);
  const sy = new Set(y);
  const common = [...sx].filter((w) => sy.has(w)).length;
  if (common === sx.size || common === sy.size) return true; // l'un contient l'autre (« Naruto » / « Naruto Shippuden »)
  return common / new Set([...sx, ...sy]).size >= 0.5;
}

export type Match = "sure" | "maybe" | null;

/**
 * - sure : même nom (mots dans le désordre, voyelles longues rapprochées) et même œuvre ;
 * - maybe : le nom de l'un est inclus dans celui de l'autre (« Luffy » / « Monkey D. Luffy ») dans la même œuvre.
 */
export function matchCharacters(a: Side, b: Side): Match {
  if (!sameSeries(a.series, b.series)) return null;
  const ka = nameKeyLoose(a.title);
  const kb = nameKeyLoose(b.title);
  if (ka && ka === kb) return "sure";
  const ta = new Set(nameTokens(a.title).map(long));
  const tb = new Set(nameTokens(b.title).map(long));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const meaningful = [...small].filter((w) => w.length >= 3);
  if (meaningful.length >= 1 && [...small].every((w) => big.has(w))) return "maybe";
  return null;
}
