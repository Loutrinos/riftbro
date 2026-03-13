import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/decks/',
  publicDir: '../images',
  server: {
    port: 5177,
    proxy: {
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
    outDir: '../dist/decks',
    emptyOutDir: true,
  },
})
