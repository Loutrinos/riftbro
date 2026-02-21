export default {
  base: '/riftbro/',
  server: {
    proxy: {
      '/riftbro/give': 'http://localhost:5174',
    }
  }
}