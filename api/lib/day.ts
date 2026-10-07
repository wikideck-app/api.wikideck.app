const formatter = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" });

// jour calendaire à Paris (AAAA-MM-JJ), pour les récompenses quotidiennes
export const parisDay = (date = new Date()) => formatter.format(date);
