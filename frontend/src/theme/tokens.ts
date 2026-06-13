/** Design tokens shared by Tailwind (via CSS vars) and ECharts. */
export const ACCENT = "#7C5CFF";

export const PALETTE = [
  "#7C5CFF", // accent violet
  "#22D3EE", // cyan
  "#34D399", // emerald
  "#FBBF24", // amber
  "#FB7185", // rose
  "#60A5FA", // blue
  "#F472B6", // pink
  "#A3E635", // lime
];

export const SOURCE_COLORS: Record<string, string> = {
  github: "#A78BFA",
  npm: "#FB7185",
  pypi: "#60A5FA",
  huggingface: "#FBBF24",
  stackoverflow: "#FB923C",
};

export const CATEGORY_COLORS: Record<string, string> = {
  mobile: "#22D3EE",
  database: "#34D399",
  "ai-model": "#FBBF24",
  embedded: "#FB7185",
  web: "#7C5CFF",
};

export const SUBSCORE_COLORS: Record<string, string> = {
  adoption: "#7C5CFF",
  activity: "#22D3EE",
  growth: "#34D399",
  community: "#FBBF24",
};
