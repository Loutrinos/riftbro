import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/give/',
  publicDir: '../images',
  server: {
    port: 5174,
    proxy: {
      '/dotgg-proxy': {
        target: 'https://api.dotgg.gg',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/dotgg-proxy/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/give',
    emptyOutDir: true,
  },
})
