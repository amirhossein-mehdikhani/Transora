/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.html"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        transora: {
          dark: '#080B11',
          card: '#0F1523',
          border: 'rgba(255, 255, 255, 0.08)',
          glow: '#6366F1',
          accent: '#06B6D4',
          violet: '#8B5CF6',
          emerald: '#10B981',
          muted: '#94A3B8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'sound-wave': 'soundWave 1.2s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))' },
          '50%': { opacity: '1', filter: 'drop-shadow(0 0 16px rgba(99, 102, 241, 0.8))' },
        },
        soundWave: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        }
      }
    },
  },
  plugins: [],
}

