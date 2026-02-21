import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/give/',
  publicDir: '../images',
  build: {
    outDir: '../dist/give',
    emptyOutDir: true,
  },
})
