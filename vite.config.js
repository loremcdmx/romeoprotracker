import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/', // Vercel: оставьте '/'. GitHub Pages: замените на '/romeoprotracker/'
});
