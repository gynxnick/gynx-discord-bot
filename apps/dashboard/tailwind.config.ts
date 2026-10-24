import type { Config } from 'tailwindcss';

/**
 * GYNX.GG design tokens. Restrained palette: Void Black background, Neon Blue
 * as the single interactive accent, Cyber Purple only for the active-nav marker.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#0B0B0F',
        surface: { DEFAULT: '#111118', raised: '#16161F', hover: '#1C1C27' },
        border: { DEFAULT: '#23232E', strong: '#33334A' },
        fg: { DEFAULT: '#E5E7EB', muted: '#9CA3AF', subtle: '#9CA3AF' },
        accent: { DEFAULT: '#22D3EE', hover: '#67E8F9', fg: '#0B0B0F', soft: 'rgba(34, 211, 238, 0.12)' },
        purple: { DEFAULT: '#7C3AED' },
        success: { DEFAULT: '#34D399', soft: 'rgba(52, 211, 153, 0.12)' },
        warning: { DEFAULT: '#FBBF24', soft: 'rgba(251, 191, 36, 0.12)' },
        danger: { DEFAULT: '#F87171', strong: '#DC2626', soft: 'rgba(248, 113, 113, 0.12)' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      borderRadius: { DEFAULT: '0.375rem' },
      ringColor: { DEFAULT: '#22D3EE' },
    },
  },
  plugins: [],
};

export default config;
