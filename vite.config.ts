import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import Sitemap from 'vite-plugin-sitemap';
import pkg from './package.json';

function getGitCommit(): string {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'dev';
    }
}

function versionManifestPlugin(): Plugin {
    return {
        name: 'vite-plugin-version-manifest',
        generateBundle() {
            const versionData = {
                version: pkg.version || '1.0.0',
                buildTimestamp: Math.floor(Date.now() / 1000),
                commit: getGitCommit()
            };
            this.emitFile({
                type: 'asset',
                fileName: 'version.json',
                source: JSON.stringify(versionData, null, 2)
            });
        }
    };
}

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      base: process.env.VERCEL ? '/' : (command === 'build' ? './' : '/'),
      envPrefix: ['VITE_', 'OPENROUTER_'],
      define: {
        'process.env.OPENROUTER_MODEL': JSON.stringify(env.OPENROUTER_MODEL || env.VITE_OPENROUTER_MODEL || 'qwen/qwen3.7-flash'),
        'process.env.OPENROUTER_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY || env.VITE_OPENROUTER_API_KEY || ''),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // Dev WebSocket proxy: /api/qwen-realtime → local Node.js proxy → DashScope
          // In production this route is handled by api/qwen-realtime.ts (Vercel function)
          '/api/qwen-realtime': {
            target: 'ws://localhost:3001',
            ws: true,
            changeOrigin: true,
            rewrite: () => '/qwen-realtime',
          },
        },
      },
      plugins: [
        react(),
        versionManifestPlugin(),
        Sitemap({
          hostname: 'https://www.avelut.xyz',
          generateRobotsTxt: false,
          dynamicRoutes: [
            '/',
            '/about',
            '/contact',
            '/t&c',
            '/policy',
            '/admin',
            '/upload-center'
          ]
        })
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        sourcemap: false,
        chunkSizeWarningLimit: 1200,
        cssCodeSplit: true,
        minify: 'esbuild',
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('@supabase')) {
                  return 'vendor-supabase';
                }
                if (id.includes('katex') || id.includes('rehype-katex') || id.includes('remark-math')) {
                  return 'vendor-katex';
                }
                if (id.includes('framer-motion')) {
                  return 'vendor-motion';
                }
                if (id.includes('@capacitor') || id.includes('@capawesome') || id.includes('@capgo')) {
                  return 'vendor-capacitor';
                }
                if (id.includes('lucide-react')) {
                  return 'vendor-icons';
                }
                if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('pdf-lib')) {
                  return 'vendor-docs';
                }
              }
            }
          }
        }
      }
    };
});
