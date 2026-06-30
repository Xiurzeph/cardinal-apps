import { defineConfig } from 'vite'

export default defineConfig({
  // Using './' (relative path) is the best way to prevent 404s in GitHub subfolders.
  // It works automatically without needing to hardcode 'cardinal-apps'.
  base: './', 
  build: {
    outDir: 'dist',
    // Ensures all CSS/JS assets are organized in the assets folder
    assetsDir: 'assets',
  }
})