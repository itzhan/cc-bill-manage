const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/**/dist/**/*.{js,ts,jsx,tsx,mjs}",
  ],
  theme: { extend: {} },
  darkMode: "class",
  plugins: [heroui()],
};
