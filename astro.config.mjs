import { defineConfig } from 'astro/config';

export default defineConfig({
   site: 'https://randomwordgenerator.info',
   output: 'static',
   trailingSlash: 'always',
   build: { inlineStylesheets: 'never' },
   devToolbar: { enabled: false },
   vite: {
      server: {
         proxy: {
            '/api': { target: process.env.WORD_API_URL || 'http://127.0.0.1:8001' },
         },
      },
   },
});
