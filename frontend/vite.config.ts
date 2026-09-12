import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { GET as liveGet } from './api/live';
import { GET as chartGet } from './api/chart';
import { GET as searchGet } from './api/search';
import { GET as newsGet } from './api/news';
import { GET as usGet } from './api/us';

function nseRelay(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (path !== '/api/live' && path !== '/api/chart' && path !== '/api/search' && path !== '/api/news' && path !== '/api/us') {
      next();
      return;
    }
    try {
      const host = req.headers.host ?? '127.0.0.1';
      const request = new Request(`http://${host}${url}`, { method: 'GET' });
      const out =
        path === '/api/chart' ? await chartGet(request)
        : path === '/api/search' ? await searchGet(request)
        : path === '/api/news' ? await newsGet(request)
        : path === '/api/us' ? await usGet(request)
        : await liveGet(request);
      res.statusCode = out.status;
      out.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'relay failed' }));
    }
  };
  const attach = (server: ViteDevServer) => {
    server.middlewares.use((req, res, next) => {
      void handle(req, res, next);
    });
  };
  return {
    name: 'nse-relay',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [react(), nseRelay()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        bypass: (req) => {
          const url = req.url ?? '';
          if (url.startsWith('/api/live') || url.startsWith('/api/chart') || url.startsWith('/api/search') || url.startsWith('/api/news') || url.startsWith('/api/us')) return false as unknown as string;
          return undefined;
        },
      },
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
});
