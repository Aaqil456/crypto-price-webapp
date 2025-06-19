/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}", // kalau ada TypeScript atau TSX future-proof
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
