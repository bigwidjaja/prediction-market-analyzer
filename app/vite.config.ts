import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev against a running compose stack: `npm run dev` serves the UI
    // with hot reload while /api is forwarded to the api container.
    proxy: {
      '/api': process.env.VITE_API_URL ?? 'http://localhost:8000',
    },
  },
})
