import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { HYDROLOOP_SYSTEM_PROMPT, formatBatchMessage, formatTrackingContext } from '@/lib/system-prompt';
import { authEnabled } from '@/lib/auth-config';
import { authOptions } from '@/lib/auth-options';
import { AiLimiter } from '@/lib/ai-limits';
import { MAX_BODY_BYTES, parseAnalyzeBody } from '@/lib/analyze-input';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIMEOUT_MS = 150_000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS) > 0 ? Number(process.env.AI_MAX_OUTPUT_TOKENS) : 8000;
/** Modèles qui acceptent le repli serveur `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const limiter = new AiLimiter();

/** Réponse d'indisponibilité : le client génère alors lui-même le rapport local (sans IA). */
const unavailable = (error: string, status = 503, extra: HeadersInit = {}) =>
  Response.json({ error, code: 'ai_unavailable' }, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

async function identify(request: Request): Promise<{ user: string } | { error: Response }> {
  if (authEnabled()) {
    const session = await getServerSession(authOptions);
    const user = (session?.user as { id?: string } | undefined)?.id;
    if (!user) return { error: Response.json({ error: 'Authentification requise.' }, { status: 401 }) };
    return { user };
  }
  // Sans comptes configurés : l'IA payante n'est ouverte à tous que si c'est demandé explicitement.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PUBLIC_AI !== 'true') {
    return { error: unavailable('Analyse IA désactivée : aucun compte configuré (voir ALLOW_PUBLIC_AI dans la documentation).', 403) };
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonyme';
  return { user: `anon:${ip}` };
}

export async function POST(request: Request) {
  const who = await identify(request);
  if ('error' in who) return who.error;

  if (!process.env.ANTHROPIC_API_KEY) return unavailable('Analyse IA non configurée sur le serveur (ANTHROPIC_API_KEY absente).');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ error: 'Requête trop volumineuse.' }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'Requête trop volumineuse.' }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }
  const parsed = parseAnalyzeBody(json);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { tracking, ...batchData } = parsed.body;

  const refused = limiter.take(who.user);
  if (refused) return unavailable(refused.message, 429, { 'Retry-After': String(refused.retryAfterSec) });

  const userMessage =
    formatBatchMessage({
      ...batchData,
      DONNEES_ENVIRONNEMENTALES: batchData.DONNEES_ENVIRONNEMENTALES as unknown as Record<string, number | string>,
    }) + formatTrackingContext(tracking);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        // Le prompt système est stable : il est mis en cache d'une analyse à l'autre.
        system: [{ type: 'text', text: HYDROLOOP_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
        ...(FALLBACK_MODELS.has(MODEL)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      },
      { signal: controller.signal },
    );

    // Attendre le premier événement : une erreur d'authentification ou de requête
    // remonte ici, avant l'envoi des en-têtes, et bascule sur le rapport de secours.
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        let wroteText = false;
        const write = (t: string) => { if (t) { wroteText = true; ctrl.enqueue(encoder.encode(t)); } };
        try {
          let step = first;
          while (!step.done) {
            const event = step.value;
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') write(event.delta.text);
            step = await iterator.next();
          }
          const final = await stream.finalMessage();
          console.info(JSON.stringify({ evt: 'ai_usage', user: who.user, model: MODEL, input: final.usage?.input_tokens, output: final.usage?.output_tokens, stop: final.stop_reason }));
          if (final.stop_reason === 'refusal') {
            write(
              `${wroteText ? '\n\n---\n\n' : ''}> ⚠️ L'analyse IA a été interrompue par le filtre de sécurité du modèle. ` +
                'Régénérez le rapport ou reformulez les notes du batch.',
            );
          } else if (final.stop_reason === 'max_tokens') {
            write('\n\n> ⚠️ Rapport tronqué (limite de longueur atteinte). Régénérez pour une version complète.');
          }
        } catch (err) {
          const reason = err instanceof Error && err.name === 'AbortError'
            ? `délai dépassé (${TIMEOUT_MS / 1000}s)`
            : err instanceof Error ? err.message : String(err);
          write(`\n\n> ⚠️ Génération interrompue : ${reason}. Régénérez le rapport.`);
        } finally {
          clearTimeout(timer);
          ctrl.close();
        }
      },
      cancel() {
        controller.abort();
        clearTimeout(timer);
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'X-Report-Source': 'ai',
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const e = describeError(err);
    console.warn(JSON.stringify({ evt: 'ai_error', user: who.user, error: e.message }));
    return unavailable(e.message, e.status);
  }
}

function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof Error && err.name === 'AbortError') return { message: `Délai dépassé (${TIMEOUT_MS / 1000}s)`, status: 504 };
  if (err instanceof Anthropic.AuthenticationError) return { message: 'Clé API Anthropic invalide', status: 503 };
  if (err instanceof Anthropic.RateLimitError) return { message: 'Limite de requêtes du fournisseur IA atteinte — réessayez dans un instant', status: 429 };
  if (err instanceof Anthropic.BadRequestError) return { message: 'Requête refusée par le service IA', status: 502 };
  if (err instanceof Anthropic.APIConnectionError) return { message: 'Service IA injoignable (connexion)', status: 503 };
  if (err instanceof Anthropic.APIError) return { message: `Erreur du service IA (${err.status ?? '?'})`, status: 502 };
  return { message: 'Erreur inattendue du service IA', status: 500 };
}
