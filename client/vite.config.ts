import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  CONTROL_CENTER_BASE_PATH,
  stripControlCenterBase,
} from './src/control-center-paths.js';

const apiTarget = 'http://localhost:9000';

export default defineConfig({
  base: CONTROL_CENTER_BASE_PATH,
  plugins: [react()],
  server: {
    proxy: {
      [`${CONTROL_CENTER_BASE_PATH}api`]: {
        target: apiTarget,
        rewrite: stripControlCenterBase,
      },
      '/api': apiTarget,
    },
  },
  build: { outDir: 'dist' },
});
