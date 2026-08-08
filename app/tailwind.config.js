/** @type {import('tailwindcss').Config} */

/*
 * Palette is driven by CSS custom properties (see src/index.css) so the UI can
 * follow prefers-color-scheme automatically. Colors are stored as space-separated
 * RGB channels so Tailwind opacity modifiers (e.g. bg-brick/10) keep working.
 */
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: channel('--color-paper'),
        surface: channel('--color-surface'),
        border: channel('--color-border'),
        ink: channel('--color-ink'),
        muted: channel('--color-muted'),
        accent: {
          DEFAULT: channel('--color-accent'),
          deep: channel('--color-accent-deep'),
        },
        'on-accent': channel('--color-on-accent'),
        olive: channel('--color-olive'),
        ochre: channel('--color-ochre'),
        brick: channel('--color-brick'),
        tint: channel('--color-tint'),
        overlay: channel('--color-overlay'),
        'card-hover': channel('--color-card-hover'),
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Fraunces"', 'Georgia', 'Cambria', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
