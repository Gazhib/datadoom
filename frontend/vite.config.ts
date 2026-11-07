import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const { VITE_API_MODE } = loadEnv(mode, process.cwd())
  return {
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    server: {
      proxy: VITE_API_MODE === 'mock' ? undefined : { '/api': 'http://127.0.0.1:8000' },
    },
  }
})
