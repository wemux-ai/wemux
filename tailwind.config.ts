import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'

const withOpacity = (variable: string) => {
  return ({ opacityValue }: { opacityValue?: string }) => {
    if (opacityValue === undefined) {
      return `var(${variable})`
    }

    const numericOpacity = Number(opacityValue)
    const opacity = Number.isNaN(numericOpacity)
      ? `calc(${opacityValue} * 100%)`
      : `${numericOpacity * 100}%`

    return `color-mix(in oklch, var(${variable}) ${opacity}, transparent)`
  }
}

export default {
  content: ['./apps/web/index.html', './apps/web/src/**/*.{ts,tsx}', '!./apps/web/src/routeTree.gen.ts', './apps/worker/src/web/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: withOpacity('--background'),
        foreground: withOpacity('--foreground'),
        card: {
          DEFAULT: withOpacity('--card'),
          foreground: withOpacity('--card-foreground'),
        },
        popover: {
          DEFAULT: withOpacity('--popover'),
          foreground: withOpacity('--popover-foreground'),
        },
        primary: {
          DEFAULT: withOpacity('--primary'),
          foreground: withOpacity('--primary-foreground'),
        },
        secondary: {
          DEFAULT: withOpacity('--secondary'),
          foreground: withOpacity('--secondary-foreground'),
        },
        muted: {
          DEFAULT: withOpacity('--muted'),
          foreground: withOpacity('--muted-foreground'),
        },
        accent: {
          DEFAULT: withOpacity('--accent'),
          foreground: withOpacity('--accent-foreground'),
        },
        destructive: {
          DEFAULT: withOpacity('--destructive'),
          foreground: withOpacity('--destructive-foreground'),
        },
        success: {
          DEFAULT: withOpacity('--success'),
          foreground: withOpacity('--success-foreground'),
        },
        warning: {
          DEFAULT: withOpacity('--warning'),
          foreground: withOpacity('--warning-foreground'),
        },
        border: withOpacity('--border'),
        input: withOpacity('--input'),
        ring: withOpacity('--ring'),
        sidebar: {
          DEFAULT: withOpacity('--sidebar'),
          foreground: withOpacity('--sidebar-foreground'),
          primary: withOpacity('--sidebar-primary'),
          'primary-foreground': withOpacity('--sidebar-primary-foreground'),
          accent: withOpacity('--sidebar-accent'),
          'accent-foreground': withOpacity('--sidebar-accent-foreground'),
          active: withOpacity('--sidebar-active'),
          'active-foreground': withOpacity('--sidebar-active-foreground'),
        },
        ink: '#131313',
        sand: '#f5ecdd',
        ember: '#d96f32',
        moss: '#436850',
        sky: '#8fb7c9',
        slate: '#334155',
      },
      boxShadow: {
        card: '0 18px 40px rgba(19, 19, 19, 0.12)',
      },
      fontFamily: {
        display: ['Georgia', 'serif'],
        body: ['"Trebuchet MS"', '"Segoe UI"', 'sans-serif'],
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        fadeUp: 'fadeUp 0.5s ease-out both',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config
