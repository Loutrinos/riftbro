import { defineConfig } from 'vite'

export default defineConfig({
  base: '/riftbro/give/',
  publicDir: '../images',
  server: {
    port: 5174,
    proxy: {
      '/api-proxy': {
        target: 'https://api.dotgg.gg',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/give',
    emptyOutDir: true,
  },
})
