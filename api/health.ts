import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
]);

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  const envModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      ok: true,
      defaultModel: ALLOWED_MODELS.has(envModel) ? envModel : DEFAULT_MODEL,
    })
  );
}
