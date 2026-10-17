import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` keeps every asset URL relative, so the same build works from a
// domain root, a GitHub Pages sub-path (/wines-public-/) or a local file server.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits until the user taps "Update", so a page is never reloaded under a half-filled form.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cellar Book',
        short_name: 'Cellar Book',
        description: 'Your wine cellar: what you own, what you paid, and when to drink it.',
        theme_color: '#7a1f3d',
        background_color: '#f7f5f1',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
