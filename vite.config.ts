import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works both at tag-art.co.uk/aurora/ and when opened locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
})
