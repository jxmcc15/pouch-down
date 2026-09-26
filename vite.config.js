import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { proxyOrigin } from './src/proxyConfig.js'

// What the page is allowed to load, and who it is allowed to talk to. Every
// directive is a closed door with the app's own origin as the only key; the one
// exception is the coach, which posts straight to the Claude API from the
// browser. `worker-src` keeps `blob:` because that is how the service worker
// and Workbox get themselves registered.
//
// The list is a whitelist, so the interesting part is what is absent:
// no `'unsafe-inline'`, no `'unsafe-eval'`, nothing to embed us in a frame,
// no third-party font host — Inter is served from our own files (src/fonts/).
// If a directive ever needs widening, widen it here and in csp.test.js, which
// pins this string on purpose.
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  // The Claude API for the direct call with a session key, plus the coach proxy
  // when one is configured — its origin comes from src/proxyConfig.js, so the
  // URL is written once and the policy can't drift from the code. No proxy
  // configured (how the repo ships) leaves this line exactly as it was.
  `connect-src 'self' https://api.anthropic.com${proxyOrigin() ? ` ${proxyOrigin()}` : ''}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ')

// GitHub Pages serves static files and can't set response headers, so the
// policy rides in the HTML as a <meta http-equiv>, at the top of <head> —
// ahead of every element that could fetch something.
//
// `apply: 'build'` is load-bearing: dev-mode hot reload needs inline script and
// a websocket back to Vite, both of which this policy forbids. Dev stays
// unpoliced; the thing that ships is the thing that's locked down.
const csp = () => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml(html) {
    const tag = `<meta http-equiv="Content-Security-Policy" content="${POLICY}" />`
    // Straight after the charset declaration when there is one — that one has
    // to stay inside the document's first 1024 bytes or the parser guesses the
    // encoding — otherwise straight after <head>. Either way the policy is in
    // place before the first element that could fetch anything.
    const anchor = /<meta\s+charset=[^>]*>/i.test(html) ? /<meta\s+charset=[^>]*>/i : /<head[^>]*>/i
    if (!anchor.test(html)) throw new Error('csp: no <head> to inject the policy into')
    return html.replace(anchor, (found) => `${found}\n    ${tag}`)
  },
})

// Served from https://<user>.github.io/pouch-down/
export default defineConfig({
  base: '/pouch-down/',
  // Fixtures are written in Central time (James's zone: noon CT, 4am-cutoff
  // days), so the suite pins it rather than inheriting the machine's zone.
  // Zone independence is tested on purpose, in zones.test.js.
  // `workers/` is in here so the coach proxy's guard tests run in `npm test` like
  // everything else — a gate nobody remembers to run is not a gate.
  test: { environment: 'node', include: ['src/**/*.test.js', 'workers/**/*.test.js'], env: { TZ: 'America/Chicago' } },
  plugins: [
    react(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pouch Down',
        short_name: 'Pouch Down',
        description: 'Taper off nicotine pouches on a plan built from your own starting point',
        theme_color: '#020203',
        background_color: '#020203',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Inter lives in src/fonts/ now, so the woff2 files are ordinary build
        // assets and this one line precaches them. There is no runtimeCaching
        // block any more: nothing the app loads comes from another origin.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
