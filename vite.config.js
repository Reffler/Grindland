import { defineConfig } from 'vite';

export default defineConfig({
    // Relative URLs work on GitHub Pages project paths and custom domains.
    base: './',
    server: {
        host: true,
        port: 8000 // Keeping the port familiar
    },
    build: {
        target: 'esnext'
    },
    publicDir: 'public' // If you have assets in a public folder, or root if not
});
