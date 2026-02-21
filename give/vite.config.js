import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/give/',
  publicDir: '../images',
  server: {
    port: 5174,
  },
  build: {
    outDir: '../dist/give',
    emptyOutDir: true,
  },
})
