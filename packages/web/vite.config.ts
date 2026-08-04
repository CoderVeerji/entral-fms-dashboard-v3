import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages build output — see plan §"Frontend (Cloudflare Pages)".
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
