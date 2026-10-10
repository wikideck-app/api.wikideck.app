const formatter = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" });

// jour calendaire à Paris (AAAA-MM-JJ), pour les récompenses quotidiennes
export const parisDay = (date = new Date()) => formatter.format(date);

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  timeZoneName: "longOffset",
});
const parisOffsetMs = (date: Date) => {
  const part = offsetFormatter.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0;
};

// minuit à Paris du jour de `date` : début de la journée pour les limites quotidiennes
export function parisDayStart(date = new Date()) {
  const [y, m, d] = parisDay(date).split("-").map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  let start = midnightUtc - parisOffsetMs(new Date(midnightUtc));
  // changement d'heure dans la nuit : on recale avec le décalage réellement en vigueur à cet instant
  start = midnightUtc - parisOffsetMs(new Date(start));
  return new Date(start);
}
