import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [basicSsl()],
  base: process.env.VITE_BASE || '/riftbro/scan/',
  publicDir: '../images',
  server: {
    port: 5176,
    host: true,   // expose on LAN (0.0.0.0) so phone can reach it
    https: true,
  },
  build: {
    outDir: '../dist/scan',
    emptyOutDir: true,
  },
})
