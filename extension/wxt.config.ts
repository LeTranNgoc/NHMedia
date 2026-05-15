import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Translate Voice',
    description: 'Lồng tiếng Việt real-time cho YouTube',
    permissions: ['tabCapture', 'offscreen', 'storage', 'identity', 'activeTab'],
    host_permissions: ['*://*.youtube.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  modules: ['@wxt-dev/module-react'],
});
