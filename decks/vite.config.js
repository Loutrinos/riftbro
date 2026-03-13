import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/decks/',
  publicDir: '../images',
  server: {
    port: 5177,
    proxy: {
      '/riftdecks-proxy': {
        target: 'https://riftdecks.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/riftdecks-proxy/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/decks',
    emptyOutDir: true,
  },
})
