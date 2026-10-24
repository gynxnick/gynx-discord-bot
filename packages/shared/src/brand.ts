/** GYNX.GG brand tokens shared by embeds, dashboard and reports. */
export const BRAND = {
  name: 'GYNX.GG',
  url: 'https://gynx.gg',
  colors: {
    voidBlack: '#0B0B0F',
    cyberPurple: '#7C3AED',
    neonBlue: '#22D3EE',
    softGray: '#9CA3AF',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#EF4444',
  },
} as const;

const hexToInt = (hex: string) => parseInt(hex.slice(1), 16);

/** Integer colours for Discord embeds. Neon Blue is the default accent; purple is used sparingly. */
export const EMBED_COLORS = {
  primary: hexToInt(BRAND.colors.neonBlue),
  accent: hexToInt(BRAND.colors.cyberPurple),
  neutral: hexToInt(BRAND.colors.softGray),
  success: hexToInt(BRAND.colors.success),
  warning: hexToInt(BRAND.colors.warning),
  danger: hexToInt(BRAND.colors.danger),
} as const;

export const SEVERITY_COLORS = {
  MINOR: EMBED_COLORS.warning,
  MAJOR: EMBED_COLORS.danger,
  CRITICAL: EMBED_COLORS.danger,
  MAINTENANCE: EMBED_COLORS.primary,
} as const;
