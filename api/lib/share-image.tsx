import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { RARITIES, type Rarity } from "@wikideck/shared";
import { SHARE_LOGO } from "@/lib/share-logo";

// palette de chaque rareté : mêmes valeurs que les cartes du site (apps/web/app/globals.css, classes .wk.r-*)
const PALETTE: Record<Rarity, { c1: string; c2: string; bd: string; glow: string; ac: string; fg: string; dark: boolean }> = {
  COMMON: { c1: "#e9e9ee", c2: "#c9cad3", bd: "#b9bac6", glow: "rgba(0,0,0,0)", ac: "#555555", fg: "#1d1b26", dark: false },
  UNCOMMON: { c1: "#f2faf2", c2: "#cfe8cf", bd: "#4caf50", glow: "rgba(76,175,80,0.53)", ac: "#2e8b3a", fg: "#1d1b26", dark: false },
  RARE: { c1: "#eaf2ff", c2: "#b6cdf5", bd: "#3b7be0", glow: "rgba(59,123,224,0.67)", ac: "#2a63c4", fg: "#1d1b26", dark: false },
  SUPER_RARE: { c1: "#2a1646", c2: "#5a2a96", bd: "#a65cf0", glow: "rgba(166,92,240,0.8)", ac: "#8b3fe0", fg: "#f6eeff", dark: true },
  ULTRA_RARE: { c1: "#2b0a1c", c2: "#7a1038", bd: "#ff4d7d", glow: "rgba(255,77,125,0.8)", ac: "#e0215a", fg: "#fff0f5", dark: true },
  LEGENDARY: { c1: "#3a2a06", c2: "#a77a12", bd: "#ffd35c", glow: "rgba(255,200,58,0.8)", ac: "#d99a00", fg: "#fff7de", dark: true },
  MYTHIC: { c1: "#15122c", c2: "#0a0917", bd: "#e9c46a", glow: "rgba(233,196,106,0.47)", ac: "#e9c46a", fg: "#f4efe0", dark: true },
};

// couleur de la pastille : l'accent éclairci de 45 % sur les raretés sombres (color-mix du site)
const lighten = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
};

// images acceptées : celles que le jeu affiche déjà (Wikipédia / Wikimedia, AniList, Kitsu)
const IMAGE_HOSTS = /(^|\.)(wikimedia\.org|wikipedia\.org|wikidata\.org|anilist\.co|kitsu\.app|kitsu\.io)$/i;

// téléchargée côté serveur (pas de souci de CORS) puis intégrée à l'image ; null si indisponible ou non prise en charge
async function inline(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !IMAGE_HOSTS.test(u.hostname)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Wikideck/1.0 (https://wikideck.app)" } });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !["image/jpeg", "image/png"].includes(type)) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 2_000_000) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

// polices du site (Outfit pour l'interface, Newsreader pour le texte des cartes), embarquées dans assets/fonts
type Font = { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" };
let fonts: Promise<Font[]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all(
    (
      [
        ["Outfit", "outfit-700", 700],
        ["Outfit", "outfit-800", 800],
        ["Newsreader", "newsreader-400", 400],
      ] as const
    ).map(async ([name, file, weight]) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(path.join(process.cwd(), "assets", "fonts", `${file}.woff`)),
    })),
  ));

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const LABEL: Record<Rarity, [string, string]> = {
  COMMON: ["Commune", "Communes"],
  UNCOMMON: ["Peu commune", "Peu communes"],
  RARE: ["Rare", "Rares"],
  SUPER_RARE: ["Super rare", "Super rares"],
  ULTRA_RARE: ["Ultra rare", "Ultra rares"],
  LEGENDARY: ["Légendaire", "Légendaires"],
  MYTHIC: ["Mythique", "Mythiques"],
};

export type ShareCard = {
  id: string;
  title: string;
  description: string | null;
  extract: string;
  imageUrl: string | null;
  rarity: Rarity;
  source: string;
};

// une carte, dessinée comme sur le site : tout est proportionnel à la largeur (1 em = 4 % de la largeur)
function Card({ card, image, isNew, width }: { card: ShareCard; image: string | null; isNew: boolean; width: number }) {
  const p = PALETTE[card.rarity];
  const em = width * 0.04;
  const anime = card.source === "ANILIST" || card.source === "KITSU";
  const border = (card.rarity === "LEGENDARY" || card.rarity === "MYTHIC" ? 0.3 : 0.2) * em;
  const info = RARITIES.find((r) => r.value === card.rarity)!;
  const st = p.dark ? lighten(p.ac, 0.45) : p.ac;
  const credit = card.source === "ANILIST" ? "Personnage · AniList" : card.source === "KITSU" ? "Personnage · Kitsu" : "Wikipédia · CC BY-SA";
  const inner = width - 2 * border - 2 * em;
  const artHeight = inner * (150 / 226);
  const mythic = card.rarity === "MYTHIC";

  return (
    <div
      style={{
        width,
        height: (width * 370) / 250,
        display: "flex",
        flexDirection: "column",
        padding: em,
        border: `${border}px solid ${p.bd}`,
        borderRadius: 2.4 * em,
        color: p.fg,
        fontFamily: "Outfit",
        background: `linear-gradient(160deg, ${p.c1}, ${p.c2})`,
        boxShadow: `0 ${em}px ${3 * em}px -${em}px rgba(0,0,0,0.45), 0 0 ${2.8 * em}px -${0.4 * em}px ${p.glow}`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 0.8 * em }}>
        <div
          style={{
            display: "flex",
            padding: `${0.3 * em}px ${0.8 * em}px`,
            borderRadius: 999,
            background: mythic ? "#15122c" : p.ac,
            color: mythic ? "#e9c46a" : "#ffffff",
            border: mythic ? `1px solid #e9c46a` : "none",
            fontSize: 1.1 * em,
            fontWeight: 800,
            letterSpacing: 0.05 * em,
          }}
        >
          {info.code}
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            marginLeft: 0.8 * em,
            minWidth: 0,
            fontSize: (anime ? 1.45 : 1.5) * em,
            fontWeight: 700,
            lineHeight: 1.2,
            lineClamp: anime ? 2 : 1,
            overflow: "hidden",
          }}
        >
          {card.title}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexGrow: anime ? 1 : 0,
          flexShrink: 0,
          ...(!anime && { height: artHeight }),
          borderRadius: 1.6 * em,
          overflow: "hidden",
          background: "linear-gradient(135deg, #a9b6cf, #6e7f9c)",
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={SHARE_LOGO} alt="" width={inner * 0.38} height={inner * 0.38} />
        )}
        <div
          style={{
            position: "absolute",
            right: 0.8 * em,
            bottom: 0.5 * em,
            display: "flex",
            fontSize: 0.8 * em,
            fontWeight: 700,
            color: "#e8e8e8",
            textShadow: "0 0 3px #000, 0 0 2px #000",
          }}
        >
          {credit}
        </div>
      </div>

      {!anime && (
        <div
          style={{
            position: "relative",
            display: "flex",
            flex: 1,
            marginTop: em,
            marginLeft: 0.4 * em,
            marginRight: 0.4 * em,
            overflow: "hidden",
            fontFamily: "Newsreader",
            fontSize: 1.25 * em,
            lineHeight: 1.35,
            opacity: 0.9,
          }}
        >
          <div style={{ display: "flex", lineClamp: 5 }}>{card.extract || card.description || ""}</div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: anime ? 0.8 * em : "auto",
          paddingTop: (anime ? 0.6 : 0.8) * em,
          paddingBottom: 0.2 * em,
          ...(anime && { minHeight: 3.4 * em }),
          borderTop: `1px solid ${p.dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.12)"}`,
        }}
      >
        {anime && card.description && (
          <div style={{ display: "flex", flex: 1, justifyContent: "center", textAlign: "center", fontSize: 0.8 * em * 1.5 / 1.5, fontWeight: 800, lineHeight: 1.15, lineClamp: 2, overflow: "hidden" }}>
            {card.description}
          </div>
        )}
        {isNew && (
          <div
            style={{
              display: "flex",
              marginLeft: anime ? 0.6 * em : 0,
              padding: `${0.3 * em}px ${1.1 * em}px`,
              border: `${0.15 * em}px solid ${st}`,
              borderRadius: 999,
              color: st,
              background: "rgba(255,255,255,0.08)",
              fontSize: 1.1 * em,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            NOUVEAU
          </div>
        )}
      </div>
    </div>
  );
}

/** image PNG (16:9) du résultat d'un tirage, avec les cartes du site ; `fresh` : cartes nouvelles pour le joueur */
export async function renderShareImage(cards: ShareCard[], fresh: Set<string>, cacheControl = "no-store") {
  const [images, fontList] = await Promise.all([Promise.all(cards.map((c) => inline(c.imageUrl))), loadFonts()]);
  const counts = RARITIES.filter((r) => cards.some((c) => c.rarity === r.value))
    .reverse()
    .map((r) => plural(cards.filter((c) => c.rarity === r.value).length, ...LABEL[r.value]));

  const W = 1600;
  const H = 900;
  const cardWidth = cards.length > 4 ? 290 : 330;
  const tilt = (i: number) => (i - (cards.length - 1) / 2) * 2.2;
  const lift = (i: number) => Math.abs(i - (cards.length - 1) / 2) * 14;

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "40px 52px",
          color: "white",
          fontFamily: "Outfit",
          background:
            "radial-gradient(800px 460px at 50% 55%, rgba(163,122,204,0.42), rgba(0,0,0,0)), radial-gradient(500px 360px at 100% 100%, rgba(255,180,84,0.16), rgba(0,0,0,0)), linear-gradient(135deg, #1a0b3d, #0b0618)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SHARE_LOGO} width={68} height={68} alt="" />
            <div style={{ display: "flex", marginLeft: 16, fontSize: 52, fontWeight: 800 }}>
              <span>Wiki</span>
              <span style={{ color: "#c4a1ff" }}>deck</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#d9ccf2" }}>
            {cards.length > 1 ? `Mon tirage : ${cards.length} cartes` : "Ma carte du tirage"}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 22, height: (cardWidth * 370) / 250 + 50 }}>
          {cards.map((card, i) => (
            <div key={card.id} style={{ display: "flex", marginTop: lift(i), transform: `rotate(${tilt(i)}deg)` }}>
              <Card card={card} image={images[i]} isNew={fresh.has(card.id)} width={cardWidth} />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 30, fontWeight: 700 }}>
          <div style={{ display: "flex", color: "#e6defa" }}>{counts.join("  ·  ")}</div>
          <div style={{ display: "flex", color: "#c4a1ff", fontWeight: 800 }}>wikideck.app</div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fontList, headers: { "Cache-Control": cacheControl } },
  );
}
