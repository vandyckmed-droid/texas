/**
 * Design tokens. Components never use raw hex — only semantic roles.
 * Dark mode is a designed palette (near-black, elevated surfaces), not an
 * inversion of light.
 */

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  /** Subtle track/fill (range-bar track, segmented background). */
  fillSubtle: string;
  /** Single brand accent — restrained, Robinhood-style. */
  accent: string;
  positive: string;
  negative: string;
  crosshair: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
}

export const lightTheme: Theme = {
  dark: false,
  colors: {
    bg: '#FFFFFF',
    bgElevated: '#F4F5F7',
    text: '#0B0B0F',
    textSecondary: '#6C7079',
    textTertiary: '#9DA1AA',
    separator: 'rgba(10, 12, 16, 0.08)',
    fillSubtle: 'rgba(10, 12, 16, 0.06)',
    accent: '#00953F',
    positive: '#00953F',
    negative: '#E5484D',
    crosshair: '#6C7079',
  },
};

export const darkTheme: Theme = {
  dark: true,
  colors: {
    bg: '#0B0B0F',
    bgElevated: '#17171D',
    text: '#F5F6F8',
    textSecondary: '#9BA1AC',
    textTertiary: '#63676F',
    separator: 'rgba(245, 246, 248, 0.09)',
    fillSubtle: 'rgba(245, 246, 248, 0.08)',
    accent: '#00D264',
    positive: '#00D264',
    negative: '#FF6369',
    crosshair: '#9BA1AC',
  },
};

/** 4pt spacing grid. */
export const space = {
  s2: 2,
  s4: 4,
  s8: 8,
  s12: 12,
  s16: 16,
  s20: 20,
  s24: 24,
} as const;

/** Screen gutter and list metrics. */
export const layout = {
  gutter: 16,
  rowHeight: 64,
  radius: 10,
  radiusSmall: 7,
} as const;

/** Type scale — system font throughout; numerals always tabular. */
export const typo = {
  largeTitle: { fontSize: 31, fontWeight: '700' as const, letterSpacing: 0.2 },
  title: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  rowSymbol: { fontSize: 16, fontWeight: '600' as const },
  rowMeta: { fontSize: 12.5, fontWeight: '400' as const },
  price: { fontSize: 15, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  micro: { fontSize: 10.5, fontWeight: '500' as const },
} as const;

/** Motion durations (ms) — one easing family app-wide. */
export const motion = {
  fast: 150,
  base: 250,
  chartMorph: 350,
} as const;
