import Anthropic from '@anthropic-ai/sdk';
import { HYDROLOOP_SYSTEM_PROMPT, formatBatchMessage } from '@/lib/system-prompt';
import { detectAlerts, PHASE_LABELS } from '@/types/batch';
import type { BatchFormData, EnvironmentalData } from '@/types/batch';
import type { StrainHistory } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TIMEOUT_MS = 90_000;

export async function POST(request: Request) {
  const body = await request.json();
  const { strainHistory, ...batchData } = body as BatchFormData & { strainHistory?: StrainHistory };

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallback(batchData, 'ANTHROPIC_API_KEY non configurée — ajoutez-la dans .env.local');
  }

  const systemPrompt = buildSystemPrompt(strainHistory);
  const userMessage = formatBatchMessage({
    ...batchData,
    DONNEES_ENVIRONNEMENTALES: batchData.DONNEES_ENVIRONNEMENTALES as unknown as Record<string, number | string>,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const stream = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: controller.signal },
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(ctrl) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              ctrl.enqueue(encoder.encode(event.delta.text));
            }
          }
        } finally {
          clearTimeout(timer);
          ctrl.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return fallback(
      batchData,
      isTimeout
        ? `Timeout dépassé (${TIMEOUT_MS / 1000}s) — le service IA est surchargé`
        : String(err),
    );
  }
}

function buildSystemPrompt(history?: StrainHistory): string {
  if (!history || history.count === 0) return HYDROLOOP_SYSTEM_PROMPT;

  const lines = [
    '\n\n## HISTORIQUE CONNU DE CETTE SOUCHE DANS LE SYSTÈME',
    `- Batches précédents enregistrés : **${history.count}**`,
    history.lastBatchDate
      ? `- Dernier batch : ${new Date(history.lastBatchDate).toLocaleDateString('fr-FR')}`
      : null,
    history.commonAlerts.length > 0
      ? `- Alertes récurrentes (≥50 % des batches de cette souche) :\n${history.commonAlerts.map((a) => `  • ${a}`).join('\n')}`
      : null,
    '\nTiens compte de ces données historiques pour affiner ton analyse et tes recommandations.',
  ];

  return HYDROLOOP_SYSTEM_PROMPT + lines.filter(Boolean).join('\n');
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

function fallback(data: BatchFormData, reason: string): Response {
  return new Response(buildFallbackReport(data, reason), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function buildFallbackReport(data: BatchFormData, reason: string): string {
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
  const progressPct = Math.min(Math.round((day / 63) * 100), 100);
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
| Progression floraison | J${day}/63 (${progressPct}%) | — |
| Grade A (45%) | — | ~${Math.round(flowerDry * plants * 0.45)} g sec |
| Grade B (35%) | — | ~${Math.round(flowerDry * plants * 0.35)} g sec |
| Grade C (20%) | — | ~${Math.round(flowerDry * plants * 0.20)} g sec |

**Timing de récolte :**
${day < 45 ? '- Trichomes en formation. Maintenir programme nutritif standard.' : day < 56 ? '- Observer les trichomes à la loupe ×60. Pistils commençant à rougir.' : '- Surveiller quotidiennement. Fenêtre de récolte imminente. Viser 50–70 % trichomes laiteux + 10–20 % ambrés.'}`
    : `*Batch en ${phaseLabel} (Jour ${day}). Estimations de rendement disponibles dès la Phase 3.*`;

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
| Santé nutritionnelle (EC ${env.EC}) | ${env.EC >= 1.0 && env.EC <= 2.5 ? '✅ Nutrition correcte' : '⚠️ EC hors plage — vérifier carences'} | — |

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
