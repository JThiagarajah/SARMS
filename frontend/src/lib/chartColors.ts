// Categorical chart palette — CVD-safe order (validated: worst adjacent-pair Delta E 9.1,
// worst normal-vision Delta E 19.6). Always assign in this fixed order; never cycle by rank.
// A slice/series always keeps the same color across re-renders even if others are filtered out.
export const CHART_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];

// Neutral "everything else" bucket — used when a composition has to be capped (pie/donut charts
// read poorly past ~6 segments; see dataviz skill anti-patterns).
export const CHART_OTHER_COLOR = "#9a9a95";
