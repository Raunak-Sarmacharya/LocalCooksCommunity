import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}", "./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      screens: {
        'xs': '475px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
        // Mobile-first breakpoints
        'mobile': { 'max': '640px' },
        'tablet': { 'min': '641px', 'max': '1024px' },
        'desktop': { 'min': '1025px' },
        // Specific mobile ranges
        'mobile-sm': { 'max': '480px' },
        'mobile-md': { 'min': '481px', 'max': '640px' },
        'mobile-lg': { 'min': '641px', 'max': '768px' },
      },
      fontFamily: {
        sans: ["Instrument Sans", "system-ui", "sans-serif"],
        display: ["Lobster", "cursive"],
        mono: ["Space Mono", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      textShadow: {
        xs: '0 1px 2px rgba(0, 0, 0, 0.25)',
        sm: '0 2px 4px rgba(0, 0, 0, 0.3)',
        md: '0 4px 8px rgba(0, 0, 0, 0.4)',
        lg: '0 8px 16px rgba(0, 0, 0, 0.5)',
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Brand colors from localcooks.ca - matching exact landing page
        cream: {
          DEFAULT: "#FFE8DD",
          light: "#FFE8DD",
          dark: "#FFD4C4",
        },
        gold: {
          DEFAULT: "#FFD700",
          light: "#FFE44D",
          dark: "#CCAA00",
        },
        charcoal: {
          DEFAULT: "#2C2C2C",
          light: "#6B6B6B",
        },
        brand: {
          primary: "#F51042",
          accent: "#6B4A4F",
          text: "#333333",
          link: "#6B4A4F",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(20px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "fade-in-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(30px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "pulse-glow": {
          "0%, 100%": {
            opacity: "1",
            boxShadow: "0 0 20px rgba(245, 16, 66, 0.3)",
          },
          "50%": {
            opacity: "0.8",
            boxShadow: "0 0 30px rgba(245, 16, 66, 0.5)",
          },
        },
        "orb-float": {
          "0%, 100%": {
            transform: "translate(0, 0) scale(1)",
          },
          "33%": {
            transform: "translate(30px, -30px) scale(1.1)",
          },
          "66%": {
            transform: "translate(-20px, 20px) scale(0.9)",
          },
        },
        "shimmer": {
          "0%": {
            backgroundPosition: "-1000px 0",
          },
          "100%": {
            backgroundPosition: "1000px 0",
          },
        },
        "auth-loading-shimmer": {
          "0%": { left: "-100%" },
          "100%": { left: "100%" },
        },
        "auth-error-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "75%": { transform: "translateX(4px)" },
        },
        "auth-success-pulse": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
        "auth-strength-grow": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "auth-email-bounce": {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "25%": { transform: "translateY(-5px) rotate(-2deg)" },
          "75%": { transform: "translateY(-5px) rotate(2deg)" },
        },
        "typewriter-cursor": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out",
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "orb-float": "orb-float 20s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "auth-loading-shimmer": "auth-loading-shimmer 1.5s infinite",
        "auth-error-shake": "auth-error-shake 0.5s ease-in-out",
        "auth-success-pulse": "auth-success-pulse 0.6s ease-out",
        "auth-strength-grow": "auth-strength-grow 0.3s ease-out",
        "auth-email-bounce": "auth-email-bounce 2s ease-in-out infinite",
        "typewriter-cursor": "typewriter-cursor 0.8s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    function ({ addUtilities, theme }: { addUtilities: any; theme: any }) {
      const textShadowUtilities: any = {};
      Object.entries(theme('textShadow') || {}).forEach(([key, value]) => {
        textShadowUtilities[`.text-shadow-${key}`] = {
          textShadow: value,
        };
      });
      addUtilities(textShadowUtilities);
    },
    // Mobile-first responsive utilities
    function ({ addUtilities }: { addUtilities: any }) {
      const mobileUtilities = {
        '.mobile-safe-area': {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        },
        '.mobile-touch-target': {
          minHeight: '44px',
          minWidth: '44px',
        },
        '.mobile-scroll-smooth': {
          scrollBehavior: 'smooth',
          '-webkit-overflow-scrolling': 'touch',
        },
        '.mobile-tap-highlight': {
          '-webkit-tap-highlight-color': 'rgba(0, 0, 0, 0.1)',
        },
        '.mobile-no-tap-highlight': {
          '-webkit-tap-highlight-color': 'transparent',
        },
        '.mobile-momentum-scroll': {
          '-webkit-overflow-scrolling': 'touch',
          overflowY: 'auto',
        },
        '.mobile-font-size-adjust': {
          textSizeAdjust: '100%',
          '-webkit-text-size-adjust': '100%',
        },
        '.mobile-viewport-units': {
          height: '100vh',
          // @ts-ignore
          height: '100dvh', // Dynamic viewport height for modern browsers
        },
      };
      addUtilities(mobileUtilities);
    }
  ],
} satisfies Config;
