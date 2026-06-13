import { defineConfig } from 'vite'

export default defineConfig({
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.obj'],
  build: {
    assetsInlineLimit: 0,
  },
})
