import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/decks/',
  publicDir: '../images',
  server: {
    port: 5177,
  },
  build: {
    outDir: '../dist/decks',
    emptyOutDir: true,
  },
})
