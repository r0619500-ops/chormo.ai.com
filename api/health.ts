import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
]);

function hasApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key !== 'your_gemini_api_key_here');
}

function hasEnvKey(name: string, placeholder: string): boolean {
  const key = process.env[name]?.trim();
  return Boolean(key && key !== placeholder);
}

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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      ok: true,
      configured: hasApiKey(),
      freeFallback: true,
      groqConfigured: hasEnvKey('GROQ_API_KEY', 'your_groq_api_key_here'),
      cerebrasConfigured: hasEnvKey('CEREBRAS_API_KEY', 'your_cerebras_api_key_here'),
      openRouterConfigured: hasEnvKey('OPENROUTER_API_KEY', 'your_openrouter_api_key_here'),
      pollinationsKeyConfigured: hasEnvKey('POLLINATIONS_API_KEY', 'your_pollinations_api_key_here'),
      defaultModel: ALLOWED_MODELS.has(envModel) ? envModel : DEFAULT_MODEL,
      allowedModels: Array.from(ALLOWED_MODELS),
    })
  );
}
