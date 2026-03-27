import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/riftbro/stats/',
  publicDir: '../images',
  server: {
    port: 5178,
  },
  build: {
    outDir: '../dist/stats',
    emptyOutDir: true,
  },
})
