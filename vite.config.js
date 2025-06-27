import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api_mexc': {
        target: 'https://api.mexc.in',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api_mexc/, ''),
      },
    },
  },
});
