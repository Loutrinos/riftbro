import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/',
  publicDir: 'images',
  server: {
    port: 5172,
    proxy: {
      '/riftbro/app':   'http://localhost:5173',
      '/riftbro/give':  'http://localhost:5174',
      '/riftbro/match': 'http://localhost:5175',
      '/riftbro/decks': 'http://localhost:5177',
      '/riftbro/stats': 'http://localhost:5178',
      '/api-proxy/riftdecks': {
        target: 'https://riftdecks.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api-proxy\/riftdecks/, ''),
      },
      '/api-proxy': {
        target: 'https://api.dotgg.gg',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
