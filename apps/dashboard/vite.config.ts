import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [TanStackRouterVite({ quoteStyle: 'single' }), react(), tailwindcss()],
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3117',
    },
  },
});
