import { defineConfig } from 'vite';
import { licenses } from './licenses.js';
export default defineConfig({
 plugins: [licenses()],
 server: { port: 5173, strictPort: true },
 preview: { port: 5173, strictPort: true, headers: {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' ws://127.0.0.1:4099; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
 } },
 build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
