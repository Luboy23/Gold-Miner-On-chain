import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) {
            return 'vendor-phaser';
          }
          if (id.includes('node_modules/viem')) {
            return 'vendor-viem';
          }
          return undefined;
        },
      },
    },
  },
});
