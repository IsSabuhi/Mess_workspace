/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px rgb(15 23 42 / 0.06)",
        "soft-lg": "0 4px 6px rgb(15 23 42 / 0.05), 0 20px 40px rgb(15 23 42 / 0.08)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
