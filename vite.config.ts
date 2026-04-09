/// <reference types="vite-plugin-pwa/react" />
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // In CI, VITE_BASE_PATH is set to /<repo-name>/ (absolute) so that both
  // index.html and crew/index.html resolve assets from the same /assets/ root.
  // With base: './' each sub-page would look for assets relative to its own
  // folder (/crew/assets/…) which doesn't exist. Fallback to './' for dev.
  base: process.env.VITE_BASE_PATH ?? './',
  build: {
    target: ['es2020', 'safari15'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        crew: resolve(__dirname, 'crew/index.html'),
      },
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
          vendor: ['react', 'react-dom', 'recharts', 'dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Liquor Manager',
        short_name: 'Liquor',
        description: 'Liquor department stock insights',
        theme_color: '#7c3aed',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          {
            src: './manifest-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: './manifest-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
