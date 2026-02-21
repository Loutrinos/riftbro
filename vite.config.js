import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/',
  publicDir: 'images',
  server: {
    port: 5172,
    proxy: {
      '/riftbro/app': 'http://localhost:5173',
      '/riftbro/give': 'http://localhost:5174',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
