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
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
