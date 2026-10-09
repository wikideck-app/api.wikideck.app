export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmPool } = await import("@/lib/card-pool");
  warmPool();
  setInterval(warmPool, 2 * 60_000).unref();
  // cache des personnages AniList : rempli dès le démarrage, par petits lots, jusqu'à être complet
  const { warmAnimePages } = await import("@/lib/anilist");
  warmAnimePages();
  setInterval(warmAnimePages, 90_000).unref();
  const { settleDue } = await import("@/lib/market");
  setInterval(() => void settleDue().catch(() => {}), 30_000).unref();
}
