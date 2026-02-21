import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/riftbro/match/',
  publicDir: '../images',
  server: {
    port: 5175,
  },
  build: {
    outDir: '../dist/match',
    emptyOutDir: true,
  },
})
