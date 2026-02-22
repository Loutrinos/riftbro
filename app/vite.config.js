import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/riftbro/app/',
  publicDir: '../images',
  server: {
    port: 5173,
    proxy: {
      '/api/dotgg': {
        target: 'https://api.dotgg.gg',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/dotgg/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
  },
})
