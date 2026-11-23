import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chatHandler from './api/chat.ts';
import healthHandler from './api/health.ts';
import transcribeHandler from './api/transcribe.ts';
import ttsHandler from './api/tts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.all('/api/health', (req: Request, res: Response) => {
    healthHandler(req, res);
  });

  app.all('/api/chat', async (req: Request, res: Response) => {
    await chatHandler(req, res);
  });

  app.all('/api/tts', async (req: Request, res: Response) => {
    await ttsHandler(req, res);
  });

  app.all('/api/transcribe', async (req: Request, res: Response) => {
    await transcribeHandler(req, res);
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CHROMO AI listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CHROMO AI server:', err);
  process.exit(1);
});
