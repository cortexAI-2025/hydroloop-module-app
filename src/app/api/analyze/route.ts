import Anthropic from '@anthropic-ai/sdk';
import { HYDROLOOP_SYSTEM_PROMPT, formatBatchMessage, formatTrackingContext } from '@/lib/system-prompt';
import type { TrackingContext } from '@/lib/system-prompt';
import { detectAlerts, PHASE_LABELS } from '@/types/batch';
import type { BatchFormData, EnvironmentalData } from '@/types/batch';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIMEOUT_MS = 240_000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
/** Modèles qui acceptent le repli serveur `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

type AnalyzeBody = BatchFormData & { tracking?: TrackingContext };

export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return Response.json({ error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }
  const { tracking, ...batchData } = body;
  if (!batchData?.BATCH_ID || !batchData.DONNEES_ENVIRONNEMENTALES || ![1, 2, 3].includes(batchData.PHASE_NUMBER)) {
    return Response.json({ error: 'Données de batch incomplètes.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallback(batchData, 'ANTHROPIC_API_KEY non configurée — ajoutez-la dans .env.local', tracking);
  }

  const userMessage =
    formatBatchMessage({
      ...batchData,
      DONNEES_ENVIRONNEMENTALES: batchData.DONNEES_ENVIRONNEMENTALES as unknown as Record<string, number | string>,
    }) + formatTrackingContext(tracking);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
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
    return fallback(batchData, describeError(err), tracking);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return `Timeout dépassé (${TIMEOUT_MS / 1000}s)`;
  if (err instanceof Anthropic.AuthenticationError) return 'Clé API Anthropic invalide';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de requêtes atteinte — réessayez dans un instant';
  if (err instanceof Anthropic.BadRequestError) return `Requête refusée par l'API : ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Service IA injoignable (connexion)';
  if (err instanceof Anthropic.APIError) return `Erreur API ${err.status ?? ''} : ${err.message}`;
  return String(err);
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

function fallback(data: BatchFormData, reason: string, tracking?: TrackingContext): Response {
  const target = data.PHASE_NUMBER === 3 && tracking?.levelTargetDays ? tracking.levelTargetDays : 27;
  return new Response(buildFallbackReport(data, reason, target), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Report-Source': 'fallback' },
  });
}

function buildFallbackReport(data: BatchFormData, reason: string, target: number): string {
  const env = data.DONNEES_ENVIRONNEMENTALES as EnvironmentalData;
  const alerts = detectAlerts(env);
  const ph = data.PHASE_NUMBER;
  const day = data.PHASE_DAY;
  const plants = data.MODULE_TYPE;
  const phaseLabel = PHASE_LABELS[ph];

  const rootFresh = ph === 1 ? 22 : ph === 2 ? 52 : 85;
  const rootDry   = Math.round(rootFresh * 0.12);
  const leafFresh = ph === 1 ? 48 : ph === 2 ? 115 : 88;
  const leafCount = ph === 1 ? 38 : ph === 2 ? 72 : 58;
  const hasTrim   = !!data.HISTORIQUE_TAILLES;
  const trimFresh = hasTrim ? (ph === 3 ? 14 : 18) : 0;
  const progressPct = Math.min(Math.round((day / target) * 100), 100);
  const flowerFresh = ph === 3 ? Math.round(80 * (progressPct / 100) * 0.8) : 0;
  const flowerDry   = Math.round(flowerFresh * 0.27);

  const alertBlock = alerts.length
    ? alerts.map((a) => `> ${a.severity === 'danger' ? '🚨' : '⚠️'} **${a.label} = ${a.value}** — ${a.message}`).join('\n')
    : '> ✅ Aucune alerte détectée sur les paramètres environnementaux.';

  const o2Ok   = env.oxygene_dissous >= 6;
  const tempOk = env.temperature_solution <= 22;
  const phOk   = env.pH >= 5.5 && env.pH <= 6.5;
  const flowOk = env.debit_NFT >= 0.5;

  const rootReco = [
    !o2Ok   && `- 🚨 Augmenter l'oxygénation immédiatement (pompe à air / diffuseur). Cible : ≥ 6 mg/L.`,
    !tempOk && `- Baisser la température de la solution à 18–20°C (refroidisseur de réservoir).`,
    !flowOk && `- Augmenter le débit NFT à minimum 0.5 L/min pour éviter les zones sèches.`,
    !phOk   && `- Corriger le pH vers 5.8–6.2 (actuellement ${env.pH}).`,
    (o2Ok && tempOk && phOk && flowOk) && `- Paramètres dans les normes. Maintenir les réglages actuels.`,
  ].filter(Boolean).join('\n');

  const flowerSection = ph === 3
    ? `
| Métrique | Valeur | Total batch (${plants} pl.) |
|---|---|---|
| Rendement frais estimé | ~${flowerFresh} g/plante | ~${flowerFresh * plants} g |
| Rendement sec (×0.27) | ~${flowerDry} g/plante | ~${flowerDry * plants} g |
| Progression niveau 3 | J${day}/${target} (${progressPct}%) | — |
| Grade A (45%) | — | ~${Math.round(flowerDry * plants * 0.45)} g sec |
| Grade B (35%) | — | ~${Math.round(flowerDry * plants * 0.35)} g sec |
| Grade C (20%) | — | ~${Math.round(flowerDry * plants * 0.20)} g sec |

**Timing de récolte :**
${progressPct < 55 ? '- Trichomes en formation. Maintenir programme nutritif standard.' : progressPct < 80 ? '- Observer les trichomes à la loupe ×60. Pistils commençant à rougir.' : '- Surveiller quotidiennement. Fenêtre de récolte imminente. Viser 50–70 % trichomes laiteux + 10–20 % ambrés.'}`
    : `*Batch en ${phaseLabel} (Jour ${day}). Estimations de rendement disponibles dès le niveau 3.*`;

  return `# Rapport Batch ${data.BATCH_ID} — ${data.SOUCHE}
## ${phaseLabel} — Jour ${day} · Module ${plants} plants

> ⚠️ **Rapport de secours (analyse locale)** — Service IA temporairement indisponible : *${reason}*
> Les estimations sont calculées à partir des seuils experts A-Frame NFT. Régénérez le rapport dès que le service est rétabli.

---

## Alertes environnementales

${alertBlock}

---

## 1. RACINES (Root Biomass)

| Métrique | Valeur | Total batch (${plants} pl.) |
|---|---|---|
| Masse fraîche estimée | ~${rootFresh} g/plante | ~${rootFresh * plants} g |
| Masse sèche (coeff. 0.12) | ~${rootDry} g/plante | ~${rootDry * plants} g |
| Oxygène dissous | ${env.oxygene_dissous} mg/L | ${o2Ok ? '✅ OK' : '🚨 INSUFFISANT'} |
| Température solution | ${env.temperature_solution}°C | ${tempOk ? '✅ OK' : '⚠️ TROP HAUTE'} |
| Débit NFT | ${env.debit_NFT} L/min | ${flowOk ? '✅ OK' : '⚠️ INSUFFISANT'} |

**Recommandations immédiates :**
${rootReco}

---

## 2. FEUILLES (Leaves)

| Métrique | Valeur | Total batch (${plants} pl.) |
|---|---|---|
| Nombre estimé | ~${leafCount} feuilles/plante | ~${leafCount * plants} |
| Masse fraîche | ~${leafFresh} g/plante | ~${leafFresh * plants} g |
| Santé nutritionnelle (EC ${env.EC}) | ${env.EC >= 1.0 && env.EC <= 2.8 ? '✅ Nutrition correcte' : '⚠️ EC hors plage — vérifier carences'} | — |

**Valorisation :**
- Feuilles saines (~75 %) → extraction de jus, compléments, paillage
- Rebut (~25 %) → compost

---

## 3. TRIMS (Résidus de taille)

${hasTrim
  ? `Historique : *${data.HISTORIQUE_TAILLES}*\n\n| Métrique | Valeur |\n|---|---|\n| Trim frais estimé | ~${trimFresh} g/plante (~${trimFresh * plants} g total) |\n| Classification | ${ph === 3 ? 'Premium Trim (floraison)' : 'Low Grade (végétatif)'} |\n| Valeur indicative | ${ph === 3 ? '50–150 €/kg' : '5–15 €/kg'} |`
  : '*Aucune taille renseignée pour ce batch.*'}

---

## 4. FLEURS (Flowers)

${flowerSection}

---

*Rapport de secours généré par HydroLoop™ — Régénérez pour obtenir l'analyse IA complète.*`;
}
