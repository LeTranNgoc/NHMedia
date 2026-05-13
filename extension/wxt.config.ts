import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Translate Voice',
    description: 'Lồng tiếng Việt real-time cho YouTube',
    permissions: ['tabCapture', 'offscreen', 'storage', 'identity', 'activeTab'],
    host_permissions: ['*://*.youtube.com/*'],
  },
  modules: ['@wxt-dev/module-react'],
});
