import { wheelPrizeLabel, type WheelPrize } from "@wikideck/shared";

const WEBHOOK = process.env.DISCORD_WHEEL_WEBHOOK_URL;

// retire le markdown et les mentions pour qu'un pseudo ne puisse rien déclencher sur Discord
const plain = (text: string) => text.replace(/[\\*_`~|>@#]/g, "").slice(0, 40);

// annonce un tour de roue sur un webhook Discord, si configuré ; ne bloque jamais le tour
export function announceSpin(player: string | null, prize: WheelPrize) {
  if (!WEBHOOK) return;
  const who = player ? `**${plain(player)}**` : "Un joueur";
  void fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `🎡 ${who} a gagné **${wheelPrizeLabel(prize)}** à la roue de la fortune !`,
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
