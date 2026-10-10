export type HealthResponse = {
  status: "ok";
  service: string;
  version?: number;
  instance?: string;
  load?: {
    activeUsers: number | null;
    openingsInFlight: number | null;
    maxConcurrentOpenings: number;
    cardPool: number;
  };
};

export type TrustLevel = "RESTRICTED" | "SUSPECT" | "TRUSTED";

export type TrustInfo = {
  level: TrustLevel;
};

export type StaffRole = "MODERATOR" | "ADMIN";

export type WheelPrize =
  | { kind: "wikibits"; amount: number; weight: number }
  | { kind: "packs"; amount: number; weight: number }
  | { kind: "boost"; amount: number; weight: number };

// l'ordre suit les secteurs de la roue, dans le sens horaire à partir du haut ; poids sur 100
export const WHEEL_PRIZES: readonly WheelPrize[] = [
  { kind: "wikibits", amount: 10, weight: 24 },
  { kind: "wikibits", amount: 25, weight: 15 },
  { kind: "packs", amount: 1, weight: 10 },
  { kind: "wikibits", amount: 5, weight: 25 },
  { kind: "boost", amount: 1, weight: 3 },
  { kind: "wikibits", amount: 15, weight: 15 },
  { kind: "packs", amount: 2, weight: 4 },
  { kind: "wikibits", amount: 100, weight: 4 },
];

export const wheelPrizeLabel = (p: Pick<WheelPrize, "kind" | "amount">) =>
  p.kind === "wikibits"
    ? `${p.amount} wikibits`
    : p.kind === "boost"
      ? "un booster de chance"
      : `${p.amount} paquet${p.amount > 1 ? "s" : ""}`;

export type WheelHistoryEntry = {
  at: string;
  prize: Pick<WheelPrize, "kind" | "amount">;
  // pseudo du joueur, null s'il garde son profil privé
  player?: string | null;
};
export type WheelHistoryResponse = { mine: WheelHistoryEntry[]; recent: WheelHistoryEntry[] };

export type WheelStatus = { canSpin: boolean };
export type WheelSpinResponse = {
  index: number;
  prize: WheelPrize;
  wikibits: number;
  packs: number;
  dropBoosts: number;
};

// wikibits offerts à la première connexion de chaque jour (heure de Paris)
export const DAILY_BONUS = 10;

export type SessionUser = {
  id: string;
  username: string;
  avatarUrl: string | null;
  settings: UserSettings;
  pendingTrades: number;
  wikibits: number;
  dailyBonus: number;
  pendingFriends: number;
  unreadMessages: number;
  claimableAchievements: number;
  live: LiveNotify | null;
  trust: TrustInfo;
  staff: StaffRole | null;
  staffAlerts: number;
};

export type MeResponse = {
  user: SessionUser | null;
};

export const RARITIES = [
  { value: "COMMON", code: "C", label: "Commune", minViews: 0 },
  { value: "UNCOMMON", code: "PC", label: "Peu commune", minViews: 50 },
  { value: "RARE", code: "R", label: "Rare", minViews: 250 },
  { value: "SUPER_RARE", code: "SR", label: "Super rare", minViews: 1_000 },
  { value: "ULTRA_RARE", code: "UR", label: "Ultra rare", minViews: 5_000 },
  { value: "LEGENDARY", code: "L", label: "Légendaire", minViews: 20_000 },
  // variante d'une légendaire, tirée avec MYTHIC_RATE quand une légendaire sort d'un paquet
  { value: "MYTHIC", code: "M", label: "Mythique", minViews: Infinity },
] as const;

export type Rarity = (typeof RARITIES)[number]["value"];

// les raretés du catalogue (la mythique n'est qu'une variante de légendaire)
export const DROP_RARITIES = RARITIES.filter((r) => r.value !== "MYTHIC");

// chance qu'une légendaire tirée soit mythique : 5 %
export const MYTHIC_RATE = 0.05;

// paquets anime / manga : à rareté égale, part des tirages qui revient aux personnages d'AniList (les plus
// connus) quand Kitsu en propose aussi ; le reste va à Kitsu
export const ANIME_ANILIST_SHARE = 0.6;

// paquets anime / manga (AniList) : rang de popularité (1 = le plus aimé) et chance de tirage de chaque rareté
export const ANIME_DROP_BANDS: { rarity: Rarity; from: number; to: number; weight: number }[] = [
  { rarity: "COMMON", from: 3501, to: 5000, weight: 0.425 },
  { rarity: "UNCOMMON", from: 2001, to: 3500, weight: 0.25 },
  { rarity: "RARE", from: 801, to: 2000, weight: 0.16 },
  { rarity: "SUPER_RARE", from: 201, to: 800, weight: 0.1 },
  { rarity: "ULTRA_RARE", from: 41, to: 200, weight: 0.05 },
  { rarity: "LEGENDARY", from: 1, to: 40, weight: 0.015 },
];
// avec un booster de chance : une légendaire garantie dans le paquet, et plus souvent mythique
export const BOOST_MYTHIC_RATE = 0.25;

export const PACK_MAX = 15;
export const PACK_SIZE = 5;

// parrainage : paquets offerts au parrain et au filleul, et nombre de filleuls récompensés par parrain
export const REFERRAL_REWARD_PACKS = 3;
export const REFERRAL_MAX = 20;
export const REFERRAL_CODE_PATTERN = /^[a-z0-9]{8}$/;
export type ReferralInfo = { code: string; referrals: number; max: number; reward: number };
export const API_VERSION = 1;
// 0,05 % par paquet
export const GODPACK_RATE = 0.0005;
// un paquet toutes les 10 minutes
export const PACK_REGEN_MS = 10 * 60 * 1000;

export type CardDto = {
  id: string;
  title: string;
  description: string | null;
  extract: string;
  imageUrl: string | null;
  url: string;
  rarity: Rarity;
  views: number;
  /** origine de la carte (absent = Wikipédia, pour les anciens clients) */
  source?: CardSource;
};

export type CardSource = "WIKIPEDIA" | "ANILIST" | "KITSU";
/** AniList et Kitsu alimentent la même collection « anime / manga » */
export const isAnimeSource = (source: CardSource | undefined) =>
  source === "ANILIST" || source === "KITSU";
export type PackKind = "wikipedia" | "anime";

export type PackKindStatus = { packs: number; max: number; nextInMs: number | null };

export type PackStatus = {
  packs: number;
  max: number;
  nextInMs: number | null;
  boosts?: number;
  /** réserve séparée de paquets anime / manga */
  anime?: PackKindStatus;
  /** paquets bonus (parrainage) : servent, pour l'un ou l'autre type, quand la réserve est vide */
  bonus?: number;
  /** paquets restants protégés contre les doublons (article de la boutique) */
  duplicateShield?: number;
  /** fin de la réduction temporaire des doublons (ISO), null = inactive */
  duplicateReductionUntil?: string | null;
};

export type OpenPackResponse = PackStatus & {
  /** cartes déjà possédées remplacées par une carte nouvelle (protection / réduction des doublons) */
  duplicatesAvoided?: number;
  cards: (CardDto & { isNew: boolean; quantity: number; tags: TagDto[] })[];
  godpack?: boolean;
};

export const TAG_COLORS = [
  "rosewater",
  "flamingo",
  "pink",
  "mauve",
  "red",
  "maroon",
  "peach",
  "yellow",
  "green",
  "teal",
  "sky",
  "sapphire",
  "blue",
  "lavender",
] as const;
export type TagColor = string;

// #abc devient #aabbcc, les anciens noms de couleur restent valides
export function normalizeTagColor(value: unknown): TagColor | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if ((TAG_COLORS as readonly string[]).includes(v)) return v;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return `#${full}`;
}

export const TAG_NAME_MAX = 24;
export const TAG_MAX_PER_USER = 30;

export type TagDto = { id: string; name: string; color: TagColor };

export type CollectionSort = "recent" | "oldest" | "rarity_desc" | "rarity_asc" | "alpha";
export const COLLECTION_SORTS: { value: CollectionSort; label: string }[] = [
  { value: "recent", label: "Plus récentes" },
  { value: "oldest", label: "Moins récentes" },
  { value: "rarity_desc", label: "Rareté : décroissante" },
  { value: "rarity_asc", label: "Rareté : croissante" },
  { value: "alpha", label: "Alphabétique (A → Z)" },
];

export type CollectionCard = CardDto & {
  quantity: number;
  inAlbum?: boolean;
  favorite?: boolean;
  tags: TagDto[];
  protectedReason?: string | null;
  estimate?: number | null;
};

export const RECYCLE_VALUES: Record<Rarity, number> = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 5,
  SUPER_RARE: 10,
  ULTRA_RARE: 15,
  LEGENDARY: 20,
  MYTHIC: 50,
};
export const RECYCLE_MAX_LINES = 200;

export type RecycleRequest =
  | { cards: { cardId: string; quantity: number }[] }
  | { duplicates: Rarity[] }
  | { bulk: BulkRecycleFilter };

export type BulkRecycleFilter = {
  maxViews: number;
  rarities: Rarity[];
  cardIds?: string[];
  excludeIds?: string[];
};

export type BulkPreviewRequest = {
  maxViews: number;
  cardIds?: string[];
  list?: boolean;
  rarities?: Rarity[];
};

export type BulkItem = {
  id: string;
  title: string;
  rarity: Rarity;
  views: number;
  quantity: number;
  wikibits: number;
};

export type BulkPreviewResponse = {
  rarities: { rarity: Rarity; cards: number; copies: number; wikibits: number }[];
  protectedCards: number;
  protectedReasons: {
    favorite: number;
    featured: number;
    showcase: number;
    trade: number;
    word: number;
  };
  items?: BulkItem[];
  truncated?: boolean;
};
export const BULK_MAX_CARD_IDS = 500;
export const BULK_LIST_MAX = 5000;

export type DuplicatesResponse = {
  rarities: {
    rarity: Rarity;
    cards: number;
    copies: number;
    wikibits: number;
  }[];
};
export type RecycleResponse = {
  gained: number;
  copies: number;
  wikibits: number;
};

export type CollectionResponse = {
  cards: CollectionCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: CollectionSort;
  tag: string | null;
  rarities: Rarity[];
  query: string;
  favoritesOnly: boolean;
  /** collection affichée : cartes Wikipédia ou anime / manga (null = toutes) */
  source: PackKind | null;
  /** cartes distinctes de chaque collection, pour les onglets */
  sourceCounts: Record<PackKind, number>;
  tags: (TagDto & { count: number })[];
};

export type CatalogSort = "rarity_desc" | "rarity_asc" | "alpha";
export const CATALOG_SORTS: { value: CatalogSort; label: string }[] = [
  { value: "rarity_desc", label: "Rareté : décroissante" },
  { value: "rarity_asc", label: "Rareté : croissante" },
  { value: "alpha", label: "Alphabétique (A → Z)" },
];

export type CatalogOwnership = "all" | "mine" | "missing" | "drawn";
export const CATALOG_OWNERSHIP: { value: CatalogOwnership; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "mine", label: "Possédées" },
  { value: "missing", label: "Manquantes" },
  { value: "drawn", label: "Déjà tirées" },
];

export type CatalogCard = CardDto & {
  owners: number;
  mine: number;
};

export type CatalogResponse = {
  cards: CatalogCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: CatalogSort;
  ownership: CatalogOwnership;
  rarities: Rarity[];
  query: string;
  counts: { rarity: Rarity; count: number }[];
  catalog: number;
  owned: number;
  /** catalogue affiché : articles Wikipédia ou personnages anime / manga */
  source: PackKind;
};

export const COLLECTION_SEARCH_MAX = 100;
export const CATALOG_SEARCH_MIN = 3;

export function searchTokens(query: string, min = 1): string[] {
  const words = query
    .toLocaleLowerCase("fr-FR")
    .split(/\s+/)
    .filter((w) => w.length >= min);
  return [...new Set(words)].slice(0, 6);
}

export const COLLECTION_PAGE_SIZE = 56;

export const IMPORT_BATCH_SIZE = 20;
export const IMPORT_MAX_CARDS = 50_000;
export const WIKI_MASTERS_ORIGINS = ["https://www.wiki-masters.com", "https://wiki-masters.com"];

export type ImportItem = {
  title: string;
  lang: string;
  quantity: number;
};

export type ImportBatchResponse = {
  imported: number;
  alreadyImported: number;
  notFound: number;
  otherLanguage: number;
  remaining: number;
};

export type AnimationSpeed = 1 | 2 | 3;
export type GraphicsQuality = "low" | "medium" | "high";
export type FrameRate = 30 | 60;
export type DefaultSort = "rarity" | "date" | "alpha";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "wikideck:theme";

export type UserSettings = {
  appearance: { theme: ThemeChoice };
  animations: { skip: boolean; speed: AnimationSpeed };
  performance: { quality: GraphicsQuality; fps: FrameRate };
  collection: {
    defaultSort: DefaultSort;
    protectedWords: string[];
  };
  accessibility: { readableFont: boolean; highContrast: boolean };
  audio: { master: number; bgm: boolean; bgmVolume: number; sfx: boolean; sfxVolume: number };
  notifications: { boosterReady: boolean; events: boolean };
};

export const DEFAULT_SETTINGS: UserSettings = {
  appearance: { theme: "system" },
  animations: { skip: false, speed: 1 },
  performance: { quality: "high", fps: 60 },
  collection: { defaultSort: "rarity", protectedWords: [] },
  accessibility: { readableFont: false, highContrast: false },
  audio: { master: 70, bgm: false, bgmVolume: 40, sfx: false, sfxVolume: 70 },
  notifications: { boosterReady: false, events: false },
};

export const DEFAULT_SORT_TO_COLLECTION: Record<DefaultSort, CollectionSort> = {
  rarity: "rarity_desc",
  date: "recent",
  alpha: "alpha",
};

const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const percent = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;
export const PROTECTED_WORDS_MAX = 50;
export const PROTECTED_WORD_MIN = 2;
export const PROTECTED_WORD_MAX = 40;

// pour comparer des textes : sans accents ni casse, ponctuation = espace
export const foldText = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const cleanWord = (s: string) => s.trim().replace(/\s+/g, " ");

const protectedWords = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const word = cleanWord(raw);
    const key = foldText(word);
    if (key.length < PROTECTED_WORD_MIN || word.length > PROTECTED_WORD_MAX || seen.has(key))
      continue;
    seen.add(key);
    words.push(word);
  }
  return words.slice(0, PROTECTED_WORDS_MAX);
};
const group = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizeSettings(raw: unknown): UserSettings {
  const root = group(raw);
  const d = DEFAULT_SETTINGS;
  const appearance = group(root.appearance);
  const animations = group(root.animations);
  const performance = group(root.performance);
  const collection = group(root.collection);
  const accessibility = group(root.accessibility);
  const audio = group(root.audio);
  const notifications = group(root.notifications);
  return {
    appearance: {
      theme: oneOf<ThemeChoice>(appearance.theme, ["system", "light", "dark"], d.appearance.theme),
    },
    animations: {
      skip: flag(animations.skip, d.animations.skip),
      speed: oneOf<AnimationSpeed>(animations.speed, [1, 2, 3], d.animations.speed),
    },
    performance: {
      quality: oneOf<GraphicsQuality>(
        performance.quality,
        ["low", "medium", "high"],
        d.performance.quality,
      ),
      fps: oneOf<FrameRate>(performance.fps, [30, 60], d.performance.fps),
    },
    collection: {
      defaultSort: oneOf<DefaultSort>(
        collection.defaultSort,
        ["rarity", "date", "alpha"],
        d.collection.defaultSort,
      ),
      protectedWords: protectedWords(collection.protectedWords, d.collection.protectedWords),
    },
    accessibility: {
      readableFont: flag(accessibility.readableFont, d.accessibility.readableFont),
      highContrast: flag(accessibility.highContrast, d.accessibility.highContrast),
    },
    audio: {
      master: percent(audio.master, d.audio.master),
      bgm: flag(audio.bgm, d.audio.bgm),
      bgmVolume: percent(audio.bgmVolume, d.audio.bgmVolume),
      sfx: flag(audio.sfx, d.audio.sfx),
      sfxVolume: percent(audio.sfxVolume, d.audio.sfxVolume),
    },
    notifications: {
      boosterReady: flag(notifications.boosterReady, d.notifications.boosterReady),
      events: flag(notifications.events, d.notifications.events),
    },
  };
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[\p{L}\p{N} ._'-]+$/u;
export const DELETE_CONFIRMATION = "SUPPRIMER";
export const PULL_HISTORY_SIZE = 50;

export type MeProfile = {
  username: string;
  displayedTitle: string | null;
  discordName: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  settings: UserSettings;
  showcase: CardDto | null;
  createdAt: string;
};

export type PullEntry = { cardId: string; title: string; url: string; rarity: Rarity };
export type PullOpening = { id: string; openedAt: string; cards: PullEntry[] };
export type PullsResponse = { openings: PullOpening[]; total: number };

export type TradeStatus =
  "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED" | "COUNTERED";

export const TRADE_MAX_CARDS = 10;
export const TRADE_MAX_PENDING = 10;
export const TRADE_MAX_PENDING_PER_PLAYER = 3;
export const TRADE_EXPIRY_DAYS = 7;
export const TRADE_HISTORY_SIZE = 50;

export type PlayerSummary = {
  id: string;
  username: string;
  avatarUrl: string | null;
  isPublic: boolean;
};

export type TradeCard = CardDto & { quantity: number };

export type TradeDto = {
  id: string;
  status: TradeStatus;
  /** contre-proposition à une proposition reçue */
  counter: boolean;
  role: "proposer" | "recipient";
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  counterparty: PlayerSummary;
  give: TradeCard[];
  receive: TradeCard[];
};

export type TradeBox = "incoming" | "outgoing" | "history";
export type TradesResponse = { trades: TradeDto[] };

export type TradeLine = { cardId: string; quantity: number };
export type CounterTradeBody = { offer: TradeLine[]; request: TradeLine[] };
export type CreateTradeBody = {
  recipientId: string;
  offer: TradeLine[];
  request: TradeLine[];
};

export const WIKIBITS_START = 500;
export const MARKET_FEE_PERCENT = 5;
export const MARKET_MAX_LISTINGS = 10;
export const MARKET_MAX_PRICE = 1_000_000;
export const MARKET_DURATIONS = [1, 6, 12, 24, 48] as const;
export const BID_EXTEND_WINDOW_S = 10;
export const BID_EXTEND_S = 60;
export const MARKET_PAGE_SIZE = 24;
export const AUCTION_BIDS_SHOWN = 50;

export const nextMinBid = (startPrice: number, currentBid: number | null) =>
  currentBid === null ? startPrice : currentBid + Math.max(1, Math.ceil(currentBid * 0.05));

export const sellerProceeds = (price: number) =>
  price - Math.floor((price * MARKET_FEE_PERCENT) / 100);

export type AuctionStatus = "ACTIVE" | "SOLD" | "UNSOLD" | "CANCELLED";

export type AuctionDto = {
  id: string;
  card: CardDto;
  seller: PlayerSummary;
  startPrice: number;
  currentBid: number | null;
  leader: PlayerSummary | null;
  bidCount: number;
  minBid: number;
  endsAt: string;
  status: AuctionStatus;
  createdAt: string;
  viewer: { isSeller: boolean; isLeader: boolean; hasBid: boolean };
};

export type MarketView = "all" | "selling" | "bidding";
export type MarketSort = "ending" | "new" | "price_asc" | "price_desc";
export const MARKET_SORTS: { value: MarketSort; label: string }[] = [
  { value: "ending", label: "Se termine bientôt" },
  { value: "new", label: "Les plus récentes" },
  { value: "price_asc", label: "Prix croissant" },
  { value: "price_desc", label: "Prix décroissant" },
];

export type MarketResponse = {
  auctions: AuctionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  view: MarketView;
  sort: MarketSort;
  rarities: Rarity[];
  query: string;
  /** une seule des deux collections (null = toutes) */
  source: PackKind | null;
  wikibits: number;
};

export type BidDto = { id: string; bidder: PlayerSummary; amount: number; createdAt: string };
export type AuctionDetail = AuctionDto & { bids: BidDto[]; wikibits: number };

export type CreateAuctionBody = { cardId: string; startPrice: number; hours: number };
export type PlaceBidBody = { amount: number };

export type MarketSale = { at: string; price: number; rarity: Rarity };
export type MarketStats = {
  rarity: Rarity | null;
  sales: number;
  last: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  points: MarketSale[];
  recent: MarketSale[];
};

export const GUILD_MAX_MEMBERS = 30;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 24;
export const GUILD_NAME_PATTERN = /^[\p{L}\p{N} .'_-]+$/u;
export const GUILD_DESCRIPTION_MAX = 140;

export const GUILD_IP_POINTS: Record<Rarity, number> = {
  COMMON: 100,
  UNCOMMON: 200,
  RARE: 300,
  SUPER_RARE: 500,
  ULTRA_RARE: 1_000,
  LEGENDARY: 2_000,
  MYTHIC: 5_000,
};

export const GUILD_REWARDS = [
  { rank: 1, label: "1re guilde", wikibits: 200 },
  { rank: 2, label: "2e guilde", wikibits: 120 },
  { rank: 3, label: "3e guilde", wikibits: 60 },
] as const;
export const GUILD_PARTICIPATION_REWARD = 20;
export const GUILD_RANKING_SIZE = 50;

export const rewardForRank = (rank: number, points: number) =>
  GUILD_REWARDS.find((r) => r.rank === rank)?.wikibits ??
  (points > 0 ? GUILD_PARTICIPATION_REWARD : 0);

export function weekStartOf(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

export type GuildSummary = {
  id: string;
  name: string;
  description: string | null;
  members: number;
  owner: string;
};

export type GuildMemberDto = {
  player: PlayerSummary;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
  ipWeek: number;
  ipTotal: number;
};

export type GuildWeekRecap = {
  weekStart: string;
  rank: number;
  points: number;
  reward: number;
};

export type GuildHome = {
  guild: { id: string; name: string; description: string | null; createdAt: string };
  role: "OWNER" | "MEMBER";
  weekStart: string;
  weekEndsAt: string;
  rank: number | null;
  points: number;
  guilds: number;
  influence: number;
  auctions: number;
  me: { ipWeek: number; ipTotal: number };
  members: GuildMemberDto[];
  lastWeek: GuildWeekRecap | null;
};

export type WishDto = {
  id: string;
  card: CardDto;
  player: PlayerSummary;
  createdAt: string;
  canGift: boolean;
  isMine: boolean;
};

export type WishesResponse = {
  wishes: WishDto[];
  mine: WishDto | null;
  receivedToday: boolean;
  resetsAt: string;
};

export type RankingEntry = {
  rank: number;
  guildId: string;
  name: string;
  members: number;
  points: number;
  isMine: boolean;
};

export type RankingResponse = {
  weekStart: string;
  weekEndsAt: string;
  entries: RankingEntry[];
  mine: RankingEntry | null;
  lastWeek: {
    weekStart: string;
    entries: { rank: number; name: string; points: number; reward: number }[];
  };
};

export type GuildsResponse = { guilds: GuildSummary[] };

export const FRIENDS_MAX = 100;
export const FRIEND_REQUESTS_MAX = 20;

export type FriendDto = {
  id: string;
  player: PlayerSummary;
  since: string;
  cards: number | null;
  showcase: CardDto | null;
};

export type FriendRequestDto = { id: string; player: PlayerSummary; createdAt: string };

export type FriendsResponse = {
  friends: FriendDto[];
  incoming: FriendRequestDto[];
  outgoing: FriendRequestDto[];
};

export type PlayerRelation = "none" | "friend" | "incoming" | "outgoing";
export type PlayerSearchResult = PlayerSummary & {
  relation: PlayerRelation;
  discordName?: string | null;
};

export const MESSAGE_MAX = 1000;
export const THREAD_PAGE_SIZE = 60;

export type MessageDto = {
  id: string;
  mine: boolean;
  body: string;
  createdAt: string;
  read: boolean;
};

export type ConversationDto = {
  player: PlayerSummary;
  last: MessageDto;
  unread: number;
};

export type ConversationsResponse = { conversations: ConversationDto[] };

export type ThreadResponse = {
  player: PlayerSummary;
  messages: MessageDto[];
  canSend: boolean;
};

export type AchievementStat =
  | "cards"
  | "superRare"
  | "ultraRare"
  | "legendary"
  | "packs"
  | "maxCopies"
  | "duplicates"
  | "showcase"
  | "trades"
  | "sold"
  | "won"
  | "soldLegendary"
  | "bigWin"
  | "balance"
  | "guild"
  | "gifts"
  | "friends"
  | "messages"
  | "tags";

export type AchievementCategory =
  "Collection" | "Raretés" | "Paquets" | "Échanges" | "Marché" | "Communauté";

export type AchievementDef = {
  key: string;
  category: AchievementCategory;
  name: string;
  description: string;
  icon: string;
  stat: AchievementStat;
  goal: number;
  reward: number;
};

const a = (
  key: string,
  category: AchievementCategory,
  name: string,
  description: string,
  icon: string,
  stat: AchievementStat,
  goal: number,
  reward: number,
): AchievementDef => ({ key, category, name, description, icon, stat, goal, reward });

export const ACHIEVEMENTS: AchievementDef[] = [
  a("cards-50", "Collection", "Débutant", "Posséder 50 cartes", "book-open", "cards", 50, 10),
  a("cards-100", "Collection", "Amateur", "Posséder 100 cartes", "medal", "cards", 100, 15),
  a("cards-250", "Collection", "Collectionneur", "Posséder 250 cartes", "award", "cards", 250, 25),
  a("cards-500", "Collection", "Expert", "Posséder 500 cartes", "crown", "cards", 500, 40),
  a(
    "cards-1000",
    "Collection",
    "Maître collectionneur",
    "Posséder 1 000 cartes",
    "library",
    "cards",
    1000,
    75,
  ),
  a(
    "cards-2500",
    "Collection",
    "Encyclopédiste",
    "Posséder 2 500 cartes",
    "landmark",
    "cards",
    2500,
    150,
  ),
  a(
    "cards-5000",
    "Collection",
    "Archiviste",
    "Posséder 5 000 cartes",
    "archive",
    "cards",
    5000,
    300,
  ),
  a(
    "cards-10000",
    "Collection",
    "Encyclopédie vivante",
    "Posséder 10 000 cartes",
    "globe",
    "cards",
    10000,
    750,
  ),
  a(
    "duplicate",
    "Collection",
    "Déjà vu",
    "Obtenir un doublon d'une carte",
    "copy",
    "duplicates",
    1,
    10,
  ),
  a(
    "stock",
    "Collection",
    "Stockeur",
    "Avoir 5 copies de la même carte",
    "layers",
    "maxCopies",
    5,
    25,
  ),
  a(
    "showcase",
    "Collection",
    "Exposition",
    "Choisir une carte vitrine",
    "sparkles",
    "showcase",
    1,
    10,
  ),
  a("tags", "Collection", "Organisé", "Créer 5 étiquettes", "tags", "tags", 5, 15),

  a(
    "sr-1",
    "Raretés",
    "Super trouvaille",
    "Obtenir votre première carte Super rare",
    "gem",
    "superRare",
    1,
    15,
  ),
  a(
    "ur-1",
    "Raretés",
    "Ultra chanceux",
    "Obtenir votre première carte Ultra rare",
    "flame",
    "ultraRare",
    1,
    30,
  ),
  a(
    "l-1",
    "Raretés",
    "Légendaire !",
    "Obtenir votre première carte Légendaire",
    "star",
    "legendary",
    1,
    75,
  ),
  a(
    "sr-10",
    "Raretés",
    "Collectionneur d'élite",
    "Posséder 10 cartes Super rares",
    "diamond",
    "superRare",
    10,
    50,
  ),
  a(
    "ur-10",
    "Raretés",
    "Ultra collectionneur",
    "Posséder 10 cartes Ultra rares",
    "flame",
    "ultraRare",
    10,
    100,
  ),
  a(
    "l-5",
    "Raretés",
    "Trouvailles légendaires",
    "Posséder 5 cartes Légendaires",
    "trophy",
    "legendary",
    5,
    150,
  ),
  a(
    "l-10",
    "Raretés",
    "Panthéon",
    "Posséder 10 cartes Légendaires",
    "landmark",
    "legendary",
    10,
    300,
  ),

  a(
    "packs-1",
    "Paquets",
    "Premier paquet",
    "Ouvrir votre premier paquet",
    "package",
    "packs",
    1,
    10,
  ),
  a("packs-25", "Paquets", "Ouvreur", "Ouvrir 25 paquets", "package-open", "packs", 25, 30),
  a(
    "packs-100",
    "Paquets",
    "Accro aux paquets",
    "Ouvrir 100 paquets",
    "package-open",
    "packs",
    100,
    100,
  ),
  a(
    "packs-500",
    "Paquets",
    "Machine à paquets",
    "Ouvrir 500 paquets",
    "package-open",
    "packs",
    500,
    400,
  ),

  a("trades-5", "Échanges", "Troqueur", "Conclure 5 échanges", "handshake", "trades", 5, 20),
  a("trades-10", "Échanges", "Négociateur", "Conclure 10 échanges", "handshake", "trades", 10, 40),
  a(
    "trades-50",
    "Échanges",
    "Pro des échanges",
    "Conclure 50 échanges",
    "handshake",
    "trades",
    50,
    150,
  ),
  a(
    "trades-100",
    "Échanges",
    "Maître du troc",
    "Conclure 100 échanges",
    "handshake",
    "trades",
    100,
    300,
  ),

  a("sold-3", "Marché", "Vendeur", "Vendre 3 cartes aux enchères", "coins", "sold", 3, 15),
  a(
    "sold-10",
    "Marché",
    "Marchand d'expérience",
    "Vendre 10 cartes aux enchères",
    "coins",
    "sold",
    10,
    50,
  ),
  a(
    "sold-100",
    "Marché",
    "Wikimilliardaire",
    "Vendre 100 cartes aux enchères",
    "coins",
    "sold",
    100,
    500,
  ),
  a(
    "sold-legendary",
    "Marché",
    "Produit de qualité",
    "Vendre une carte Légendaire aux enchères",
    "badge-check",
    "soldLegendary",
    1,
    50,
  ),
  a("won-5", "Marché", "Acheteur", "Gagner 5 enchères", "gavel", "won", 5, 20),
  a(
    "won-25",
    "Marché",
    "Trouveur de bonnes affaires",
    "Gagner 25 enchères",
    "gavel",
    "won",
    25,
    110,
  ),
  a(
    "big-win",
    "Marché",
    "Mon précieux",
    "Gagner une enchère pour plus de 5 fois la mise de départ",
    "party-popper",
    "bigWin",
    1,
    100,
  ),
  a(
    "balance-2500",
    "Marché",
    "Gestion de patrimoine",
    "Posséder 2 500 wikibits",
    "wallet",
    "balance",
    2500,
    100,
  ),

  a("guild", "Communauté", "Camarade", "Rejoindre une guilde", "castle", "guild", 1, 10),
  a(
    "gift-1",
    "Communauté",
    "Généreux",
    "Offrir une carte à un camarade de guilde",
    "gift",
    "gifts",
    1,
    20,
  ),
  a(
    "gift-10",
    "Communauté",
    "Mécène",
    "Offrir 10 cartes à vos camarades",
    "gift",
    "gifts",
    10,
    100,
  ),
  a("friend-1", "Communauté", "Sociable", "Avoir un ami", "user-plus", "friends", 1, 10),
  a("friend-10", "Communauté", "Populaire", "Avoir 10 amis", "users", "friends", 10, 50),
  a(
    "messages-50",
    "Communauté",
    "Bavard",
    "Envoyer 50 messages",
    "message-circle",
    "messages",
    50,
    25,
  ),
];

export type AchievementState = {
  key: string;
  progress: number;
  unlockedAt: string | null;
  claimed: boolean;
  isNew: boolean;
};

export type AchievementsResponse = {
  achievements: AchievementState[];
  unlocked: number;
  claimable: number;
  total: number;
  wikibits: number;
};

export type ClaimAchievementsResponse = {
  claimed: { key: string; reward: number }[];
  wikibits: number;
};

export type DropRate = {
  rarity: Rarity;
  count: number;
  percent: number;
  perPack: number;
};

export type DropRatesResponse = {
  total: number;
  rates: DropRate[];
  godpack: number;
};

export type LiveNotify = { url: string; topic: string };

export type LiveEvent =
  | { type: "message"; from: string }
  | { type: "friend"; from: string; accepted?: boolean }
  | { type: "trade"; from: string }
  | { type: "outbid"; auction: string }
  | { type: "auction"; auction: string }
  | { type: "wishlist"; auction: string; card: string }
  | { type: "gift"; from: string }
  | { type: "achievement" }
  | { type: "staff"; kind: "alert" | "report" | "bug" };

export type ProfileStats = {
  cards: number;
  /** cartes Wikipédia différentes possédées : détermine son titre Wikipédia */
  wikipediaCards: number;
  /** personnages anime / manga différents possédés : détermine son titre anime */
  animeCards: number;
  completion: number;
  copies: number;
  byRarity: Record<Rarity, number>;
  packs: number;
  trades: number;
  auctionsSold: number;
  auctionsWon: number;
  friends: number;
};

export const FEATURED_MAX = 6;

export type ProfileDto = {
  player: PlayerSummary;
  /** titre que le joueur a choisi d'afficher (identifiant, voir parseTitleId), null = automatique */
  displayedTitle: string | null;
  createdAt: string;
  isSelf: boolean;
  relation: PlayerRelation;
  friendshipId: string | null;
  guild: { id: string; name: string; role: "OWNER" | "MEMBER" } | null;
  visible: boolean;
  stats: ProfileStats | null;
  showcase: CardDto | null;
  featured: (CardDto & { quantity: number })[];
  featuredAuto: boolean;
  wishlist: CardDto[];
  achievements: string[];
  /** albums que le joueur a choisi d'afficher (au plus PROFILE_ALBUMS_MAX) */
  albums: AlbumSummary[];
};

export const PROFILE_ALBUMS_MAX = 6;

export type BattlePuzzle = { start: string; target: string };

export type BattleGameDto = {
  id: string;
  mode: "solo" | "multi";
  start: string;
  target: string;
  path: string[];
  clicks: number;
  timeSeconds: number;
  won: boolean;
  playedAt: string;
};

export type BattleStats = {
  played: number;
  wins: number;
  bestClicks: number | null;
  bestTime: number | null;
};

export type BattleHistoryResponse = { stats: BattleStats; games: BattleGameDto[] };

export type BattleGameInput = {
  start: string;
  target: string;
  path: string[];
  clicks: number;
  timeSeconds: number;
  won: boolean;
};

export const BATTLE_PATH_MAX = 300;

export type BattleGameMode = "race" | "all_finish";
export type BattlePhase = "waiting" | "countdown" | "playing" | "results";

export type BattlePlayer = {
  id: string;
  name: string;
  avatarUrl: string | null;
  score: number;
  roundPoints: number;
  path: string[];
  hasWon: boolean;
  hasSurrendered: boolean;
  isHost: boolean;
  lastSeen: number;
  wonAt: number | null;
};

export type BattleRoom = {
  code: string;
  players: BattlePlayer[];
  phase: BattlePhase;
  round: number;
  totalRounds: number;
  maxPlayers: number;
  gameMode: BattleGameMode;
  searchAllowed: boolean;
  timeLimit: number;
  startArticle: string;
  targetArticle: string;
  roundWinner: string | null;
  rewards: Record<string, number>;
  countdownStart: number | null;
  roundStart: number | null;
  createdAt: number;
};

export type BattleRoomSettings = {
  gameMode: BattleGameMode;
  maxPlayers: number;
  totalRounds: number;
  timeLimit: number;
  searchAllowed: boolean;
};

export const BATTLE_COUNTDOWN_MS = 3000;

export const BATTLE_ROUND_REWARD = 10;
export const BATTLE_ROUND_BONUS_PER_PLAYER = 5;
export const BATTLE_GAME_REWARD = 25;
export const BATTLE_GAME_BONUS_PER_PLAYER = 10;
export const BATTLE_REWARD_PLAYERS_CAP = 8;
export const BATTLE_DAILY_CAP = 300;
export const BATTLE_MIN_PLAYERS = 2;
export const BATTLE_MAX_PLAYERS = 20;
export const BATTLE_MAX_ROUNDS = 10;

export type BattleRoomAction =
  | { action: "join" }
  | { action: "leave" }
  | { action: "heartbeat" }
  | { action: "start" }
  | { action: "play" }
  | { action: "navigate"; article: string }
  | { action: "surrender" }
  | { action: "timeUp" }
  | { action: "nextRound" }
  | { action: "reset" }
  | { action: "settings"; settings: Partial<BattleRoomSettings> };

export type BattleRoomResponse = { room: BattleRoom };

export type StaffOverview = {
  users: number;
  newUsers7d: number;
  banned: number;
  staff: number;
  packsOpened24h: number;
  wikibitsTotal: number;
  auctionsActive: number;
  tradesPending: number;
  battleGames24h: number;
  flagged: number;
};

export type StaffMemberRow = {
  id: string;
  username: string;
  /** identifiant et nom d'utilisateur Discord, pour synchroniser avec un bot ou un serveur */
  discordId: string;
  discordName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  wikibits: number;
  cards: number;
  staff: StaffRole | null;
  banned: boolean;
  trust: TrustLevel;
};

export type StaffSyncResponse = {
  /** comme la liste des membres, sans le niveau de confiance (calcul trop coûteux pour un export) */
  users: Omit<StaffMemberRow, "trust">[];
  /** curseur pour la page suivante (`after`), null à la fin */
  next: string | null;
  total: number;
};

export type StaffAuditRow = {
  id: string;
  actorName: string;
  action: string;
  targetId: string | null;
  targetName: string | null;
  detail: unknown;
  createdAt: string;
};

export type StaffApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  ownerName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type StaffApiKeyCreated = { key: string; row: StaffApiKeyRow };

export const API_KEY_MAX_PER_USER = 10;

export type StaffMemberDetail = StaffMemberRow & {
  discordId: string;
  discordCreatedAt: string | null;
  packs: number;
  pulls: number;
  battle: { played: number; wins: number };
  banReason: string | null;
  bannedAt: string | null;
  trustOverride: "TRUSTED" | "RESTRICTED" | null;
  trustScore: number;
  riskScore: number;
  signals: { type: string; weight: number; at: string }[];
  linkedAccounts: { id: string; username: string }[];
  actions: StaffAuditRow[];
};

export type StaffAlert = {
  id: string;
  username: string;
  avatarUrl: string | null;
  riskScore: number;
  level: TrustLevel;
  signals: string[];
};

export type StaffUserAction =
  | { action: "ban"; reason: string }
  | { action: "unban" }
  | { action: "rename"; username: string }
  | { action: "setTrust"; override: "TRUSTED" | "RESTRICTED" | null }
  | { action: "clearSignals" }
  | { action: "wikibits"; amount: number; reason: string }
  | { action: "packs"; count: number }
  | { action: "setRole"; role: StaffRole | null }
  | { action: "delete"; confirm: string; reason: string };

export type StaffAuctionRow = {
  id: string;
  card: { id: string; title: string; rarity: Rarity };
  seller: { id: string; username: string };
  leader: { id: string; username: string } | null;
  startPrice: number;
  currentBid: number | null;
  bidCount: number;
  endsAt: string;
  status: AuctionStatus;
  createdAt: string;
};

export type StaffGuildRow = {
  id: string;
  name: string;
  description: string | null;
  members: number;
  owner: string | null;
  createdAt: string;
};

export type StaffGuildDetail = StaffGuildRow & {
  memberList: { id: string; username: string; role: "OWNER" | "MEMBER"; joinedAt: string }[];
  openWishes: number;
};

export type StaffReportRow = {
  id: string;
  status: "OPEN" | "DISMISSED" | "DELETED";
  createdAt: string;
  reporter: { id: string; username: string };
  sender: { id: string; username: string };
  body: string;
  context: { from: "sender" | "reporter"; body: string; at: string }[];
  handledBy: string | null;
  handledAt: string | null;
};

export const BUG_REPORT_MIN = 10;
export const BUG_REPORT_MAX = 2000;
export const BUG_REPORT_OPEN_MAX = 5;

export type BugReportInput = { message: string; page?: string };

export type StaffBugReportRow = {
  id: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  reporter: { id: string; username: string };
  message: string;
  page: string | null;
  userAgent: string | null;
  handledBy: string | null;
  handledAt: string | null;
};

export type StaffBugReportAction = { action: "resolve" } | { action: "dismiss" };

export type StaffAuctionAction = { action: "cancel"; reason: string };
export type StaffGuildAction =
  | { action: "edit"; name?: string; description?: string }
  | { action: "kick"; userId: string }
  | { action: "dissolve"; confirmName: string };
export type StaffReportAction = { action: "dismiss" } | { action: "deleteMessage" };

export const RANKING_BOARDS = [
  {
    value: "collection",
    label: "Collection",
    unit: "cartes",
    hint: "Cartes différentes possédées",
  },
  {
    value: "points",
    label: "Points de rareté",
    unit: "pts",
    hint: "Une carte vaut ce qu'elle rapporte au recyclage",
  },
  { value: "battle", label: "Bataille", unit: "victoires", hint: "Parties de Bataille gagnées" },
] as const;
export type RankingBoard = (typeof RANKING_BOARDS)[number]["value"];
export const RANKING_SIZE = 50;

export type PlayerRankEntry = {
  rank: number;
  id: string;
  username: string;
  avatarUrl: string | null;
  score: number;
  isMe: boolean;
};

export type PlayerRankingResponse = {
  board: RankingBoard;
  entries: PlayerRankEntry[];
  mine: PlayerRankEntry | null;
  publicOnly: boolean;
};

export const WISHLIST_MAX = 3;

export type WishlistCard = CardDto & {
  quantity: number;
  addedAt: string;
};

export type WishlistResponse = { cards: WishlistCard[]; max: number };

export type DeletedAccountRow = {
  id: string;
  username: string;
  at: string;
  /** Membre du staff qui a supprimé le compte ; null si le joueur l'a supprimé lui-même */
  by: string | null;
  reason: string | null;
  /** Seulement pour les suppressions par le staff : un joueur qui efface son compte n'en laisse pas */
  discordId: string | null;
};

export const ALBUM_NAME_MAX = 40;
// albums et sous-albums confondus
export const ALBUM_MAX_PER_USER = 100;
// niveaux de classeur : un album, ses sous-albums, leurs sous-albums...
export const ALBUM_MAX_DEPTH = 4;
export const ALBUM_CARDS_MAX = 500;
export const ALBUM_ADD_BATCH = 100;
export const ALBUM_HIGHLIGHTS = 3;

export type AlbumSummary = {
  id: string;
  name: string;
  /** null pour un album de premier niveau */
  parentId: string | null;
  onProfile?: boolean;
  /** cartes distinctes de l'album et de tous ses sous-albums */
  cards: number;
  subAlbums: number;
  top: CardDto[];
  hasCard?: boolean;
  updatedAt: string;
};

export type AlbumsResponse = { albums: AlbumSummary[]; max: number };

export type AlbumResponse = {
  album: { id: string; name: string; parentId: string | null; onProfile: boolean; createdAt: string };
  /** du premier niveau jusqu'au parent direct */
  trail: { id: string; name: string }[];
  children: AlbumSummary[];
  /** niveau de l'album (1 = premier niveau) et plus grand niveau atteint dans son arbre */
  depth: number;
  /** « all » : cartes de l'album et de ses sous-albums ; « own » : celles de l'album seul */
  scope: "own" | "all";
  count: number;
  highlights: CollectionCard[];
  cards: CollectionCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rarities: Rarity[];
  query: string;
  counts: { rarity: Rarity; count: number }[];
};

export type AlbumCandidatesResponse = {
  cards: CollectionCard[];
  total: number;
  page: number;
  totalPages: number;
  room: number;
};


// ---- boutique (articles payés en wikibits, gérés par les administrateurs)
export const SHOP_KINDS = [
  "WIKIPEDIA_PACKS",
  "ANIME_PACKS",
  "LUCK_BOOST",
  "DUPLICATE_SHIELD",
  "DUPLICATE_REDUCTION",
] as const;
// réduction des doublons : chance de remplacer chaque carte déjà possédée (la protection les remplace toutes)
export const DUPLICATE_REDUCTION_CHANCE = 0.5;
export type ShopItemKind = (typeof SHOP_KINDS)[number];
export const SHOP_NAME_MAX = 60;
export const SHOP_DESCRIPTION_MAX = 240;
export const SHOP_MAX_PRICE = 1_000_000;
export const SHOP_MAX_AMOUNT = 100;
export const SHOP_MAX_ITEMS = 50;

export type ShopItemDto = {
  id: string;
  name: string;
  description: string | null;
  kind: ShopItemKind;
  amount: number;
  price: number;
  maxPerUser: number | null;
  /** achats maximum par joueur et par jour (jour de Paris), null = illimité */
  maxPerUserPerDay: number | null;
  /** exemplaires restants, null = illimité */
  stock: number | null;
  /** achats déjà faits par le joueur */
  purchased: number;
  /** achats faits aujourd'hui par le joueur */
  purchasedToday: number;
  /** fin de l'offre (ISO), null = sans limite de durée */
  availableUntil: string | null;
};

export type ShopResponse = { items: ShopItemDto[]; wikibits: number };
export type ShopBuyResponse = { wikibits: number; item: ShopItemDto };

export type StaffShopItem = Omit<ShopItemDto, "purchased" | "purchasedToday"> & {
  active: boolean;
  /** début de l'offre (ISO), null = déjà ouverte */
  availableFrom: string | null;
  sortOrder: number;
  /** achats réalisés depuis la création de l'article */
  sold: number;
};
export type StaffShopInput = {
  name: string;
  description: string | null;
  kind: ShopItemKind;
  amount: number;
  price: number;
  maxPerUser: number | null;
  maxPerUserPerDay: number | null;
  stock: number | null;
  active: boolean;
  /** fenêtre de vente facultative (dates ISO) */
  availableFrom: string | null;
  availableUntil: string | null;
  sortOrder: number;
};

// ---- titres : gagnés avec le nombre de cartes Wikipédia différentes possédées (l'anime / manga ne compte pas)
export const PLAYER_TITLES = [
  { min: 0, key: "newPlayer", emoji: "🃏" },
  { min: 10, key: "reader", emoji: "📖" },
  { min: 50, key: "curious", emoji: "🔎" },
  { min: 100, key: "amateur", emoji: "📚" },
  { min: 250, key: "connoisseur", emoji: "🧠" },
  { min: 500, key: "scholar", emoji: "🎓" },
  { min: 1_000, key: "encyclopedist", emoji: "🏛️" },
  { min: 2_500, key: "historian", emoji: "📜" },
  { min: 5_000, key: "expert", emoji: "🔬" },
  { min: 10_000, key: "master", emoji: "👑" },
  { min: 25_000, key: "legend", emoji: "🌟" },
  { min: 50_000, key: "guardian", emoji: "🏆" },
] as const;
export type PlayerTitle = (typeof PLAYER_TITLES)[number];

// titres de la collection anime / manga (personnages d'AniList et de Kitsu), mêmes seuils
export const ANIME_TITLES = [
  { min: 0, key: "newFan", emoji: "🍙" },
  { min: 10, key: "viewer", emoji: "📺" },
  { min: 50, key: "otakuBeginner", emoji: "🎬" },
  { min: 100, key: "mangaReader", emoji: "📖" },
  { min: 250, key: "fan", emoji: "⭐" },
  { min: 500, key: "enthusiast", emoji: "🎭" },
  { min: 1_000, key: "otaku", emoji: "🗾" },
  { min: 2_500, key: "heroHunter", emoji: "⚔️" },
  { min: 5_000, key: "sensei", emoji: "🌸" },
  { min: 10_000, key: "otakuMaster", emoji: "👑" },
  { min: 25_000, key: "animationLegend", emoji: "🌟" },
  { min: 50_000, key: "animeGuardian", emoji: "🏯" },
] as const;
export type AnimeTitle = (typeof ANIME_TITLES)[number];

type TitleOf<K extends string> = { min: number; key: K; emoji: string };
function pickTitle<T extends TitleOf<string>>(list: readonly T[], cards: number) {
  let index = 0;
  list.forEach((t, i) => {
    if (cards >= t.min) index = i;
  });
  return { title: list[index], next: list[index + 1] ?? null };
}

/** Titre actuel d'un joueur et prochain à atteindre (null au plus haut titre). */
/** Identifiant d'un titre choisi : « wikipedia:scholar », « anime:sensei ». */
export function parseTitleId(
  id: unknown,
): { kind: "wikipedia" | "anime"; key: string; min: number; emoji: string } | null {
  if (typeof id !== "string") return null;
  const [kind, key] = id.split(":");
  const list = kind === "wikipedia" ? PLAYER_TITLES : kind === "anime" ? ANIME_TITLES : null;
  const found = list?.find((t) => t.key === key);
  return list && found ? { kind: kind as "wikipedia" | "anime", key: found.key, min: found.min, emoji: found.emoji } : null;
}
/** valeur de displayedTitle : le joueur ne veut afficher aucun titre */
export const NO_TITLE = "none";
export const titleId = (kind: "wikipedia" | "anime", key: string) => `${kind}:${key}`;

export const playerTitle = (wikipediaCards: number) => pickTitle(PLAYER_TITLES, wikipediaCards);
export const animeTitle = (animeCards: number) => pickTitle(ANIME_TITLES, animeCards);

// ---- quêtes : objectifs récompensés en wikibits, à récupérer une seule fois
// récompense de chaque titre (le premier titre, « Nouveau joueur », ne rapporte rien)
export const TITLE_QUEST_REWARDS: Record<Exclude<PlayerTitle["key"], "newPlayer">, number> = {
  reader: 50,
  curious: 75,
  amateur: 100,
  connoisseur: 150,
  scholar: 175,
  encyclopedist: 200,
  historian: 250,
  expert: 275,
  master: 300,
  legend: 400,
  guardian: 500,
};

export const ANIME_TITLE_QUEST_REWARDS: Record<Exclude<AnimeTitle["key"], "newFan">, number> = {
  viewer: 50,
  otakuBeginner: 75,
  mangaReader: 100,
  fan: 150,
  enthusiast: 175,
  otaku: 200,
  heroHunter: 250,
  sensei: 275,
  otakuMaster: 300,
  animationLegend: 400,
  animeGuardian: 500,
};

export type QuestKind = "wikipedia_cards" | "anime_cards";

export type QuestDef = {
  /** identifiant stable : sert à retenir ce que le joueur a déjà récupéré */
  id: string;
  kind: QuestKind;
  /** nombre de cartes différentes à posséder (Wikipédia, ou anime / manga selon le type) */
  target: number;
  reward: number;
  titleKey: string;
  emoji: string;
};

export const QUESTS: QuestDef[] = [
  ...PLAYER_TITLES.filter((t) => t.min > 0).map((t) => ({
    id: `title:${t.key}`,
    kind: "wikipedia_cards" as const,
    target: t.min,
    reward: t.key === "newPlayer" ? 0 : TITLE_QUEST_REWARDS[t.key],
    titleKey: t.key as string,
    emoji: t.emoji as string,
  })),
  ...ANIME_TITLES.filter((t) => t.min > 0).map((t) => ({
    id: `anime:${t.key}`,
    kind: "anime_cards" as const,
    target: t.min,
    reward: t.key === "newFan" ? 0 : ANIME_TITLE_QUEST_REWARDS[t.key],
    titleKey: t.key as string,
    emoji: t.emoji as string,
  })),
];

export type QuestDto = QuestDef & {
  progress: number;
  claimed: boolean;
  claimable: boolean;
};
export type QuestsResponse = { quests: QuestDto[]; wikibits: number };
export type QuestClaimResponse = { wikibits: number; reward: number };
