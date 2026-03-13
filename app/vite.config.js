import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE || '/riftbro/app/',
  publicDir: '../images',
  server: {
    port: 5173,
    proxy: {
      '/dotgg-proxy': {
        target: 'https://api.dotgg.gg',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/dotgg-proxy/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
  },
})
