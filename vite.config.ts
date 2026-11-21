import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Sombrear Dashboard',
        short_name: 'Sombrear',
        description: 'Orçamentos, estoque, preços e agente IA da Sombrear',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        theme_color: '#E8701A',
        background_color: '#F3F5F7',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA: navegação cai no index; API (Supabase/n8n) nunca é cacheada (cross-origin fica de fora)
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // o codificador de voz (385 KB) só baixa quando alguém grava áudio na aba Conversas
        globIgnores: ['**/opus/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-query':   ['@tanstack/react-query'],
          'vendor-supabase':['@supabase/supabase-js'],
          'vendor-charts':  ['recharts'],
          'vendor-xlsx':    ['xlsx'],
          'vendor-pdf':     ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
})
