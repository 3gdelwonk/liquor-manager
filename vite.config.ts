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
      workbox: {
        // Exclude the /crew/ sub-app from the main navigation fallback.
        // Without this, workbox's default NavigationRoute catches every
        // navigation request and returns the main index.html, so the crew
        // PWA launches the main app's bundle under the /crew/ URL.
        navigateFallbackDenylist: [/^\/liquor-manager\/crew\//, /^\/crew\//],
      },
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
    // vite-plugin-pwa auto-injects `<link rel="manifest" href=".../manifest.webmanifest">`
    // into every HTML entry using the main manifest URL. For the crew sub-app
    // that means Safari reads the *main* manifest when you Add to Home Screen,
    // picks up its start_url="./" (which resolves to /liquor-manager/), and
    // launches the pinned crew app into the main UI. This post-transform runs
    // after VitePWA's injection and rewrites the href on the crew entry to
    // point at its own manifest (which resolves to /<base>/crew/manifest.webmanifest).
    {
      name: 'crew-manifest-rewrite',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          const f = ctx.filename.replace(/\\/g, '/')
          if (!f.endsWith('crew/index.html')) return html
          return html.replace(
            /<link rel="manifest"[^>]*>/,
            '<link rel="manifest" href="./manifest.webmanifest">'
          )
        },
      },
    },
  ],
})
