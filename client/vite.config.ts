import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stripBasePath } from './src/control-center-paths.js';

const apiTarget = 'http://localhost:9000';
const allowedHosts = ['damkeeper.top', 'www.damkeeper.top', 'localhost'];

export function createViteConfig(publicBasePath = '/') {
  const proxy = publicBasePath === '/'
    ? { '/api': apiTarget }
    : {
        [`${publicBasePath}api`]: {
          target: apiTarget,
          rewrite: (path: string) => stripBasePath(path, publicBasePath),
        },
        '/api': apiTarget,
      };

  return defineConfig({
    base: publicBasePath,
    plugins: [react()],
    server: { allowedHosts, proxy },
    build: { outDir: 'dist' },
  });
}

export default createViteConfig(
  process.env.CONTROL_CENTER_PUBLIC_BASE_PATH ?? '/',
);
