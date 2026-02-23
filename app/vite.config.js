import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/riftbro/app/',
  publicDir: '../images',
  server: {
    port: 5173,
  },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
  },
})
