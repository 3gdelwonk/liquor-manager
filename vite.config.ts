/// <reference types="vite-plugin-pwa/react" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE_PATH ?? './'
const startUrl = process.env.VITE_BASE_PATH ?? './'

export default defineConfig({
  base,
  build: {
    target: ['es2020', 'safari15'],
    rollupOptions: {
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
        start_url: startUrl,
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
