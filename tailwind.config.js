/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 16px 40px rgba(15, 23, 42, 0.25)',
      },
      colors: {
        slate: {
          950: '#020817',
        },
      },
    },
  },
  plugins: [],
};
