/**
 * Official Swim School Academy colour and type.
 * Change colours and fonts here only — the app, admin, and payment pages read these values.
 * `headline` is Figtree Bold until a Beach House licence is in place; swap that one token later.
 */
const red = "#E6341C";
const navy = "#28324C";
const sand = "#FEF7EF";
const atlantic = "#076EB5";
const seaGlass = "#BFDAD3";
const white = "#FFFFFF";

export const colors = {
  red,
  navy,
  sand,
  atlantic,
  seaGlass,
  white,
  paper: sand,
  ink: navy,
  deep: navy,
  pool: atlantic,
  muted: "#5C6A80",
  line: "#E6D9C8",
  surround: "#F3EBE3",
  danger: "#8E2F2F",
  dangerBg: "#F8E8E4",
  ok: "#1F6B45",
  okBg: "#E5F2EA",
  warn: "#8A5A00",
  warnBg: "#F8EFD9",
  headerMuted: seaGlass,
  openDay: seaGlass,
  dayIdle: "#F6EFE6",
};

export const fonts = {
  /** Display headlines. Figtree Bold stands in for Beach House. */
  headline: "Figtree_700Bold",
  cta: "Figtree_700Bold",
  heading: "Figtree_600SemiBold",
  strong: "Figtree_600SemiBold",
  highlight: "Figtree_500Medium",
  body: "Figtree_400Regular",
  webFamily: "Figtree, sans-serif",
  googleStylesheet: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap",
} as const;

export const headline = fonts.headline;
export const display = fonts.headline;
export const cta = fonts.cta;
export const heading = fonts.heading;
export const strong = fonts.strong;
export const highlight = fonts.highlight;
export const body = fonts.body;
