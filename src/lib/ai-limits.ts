import { WindowLimiter } from './rate-limit';

/** Limites de coût de l'analyse IA (par instance serveur). Réglables par variables d'environnement. */
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export interface AiLimitConfig { perUserPer10Min: number; perUserPerDay: number; globalPerDay: number }

export function aiLimitConfig(env: Record<string, string | undefined> = process.env): AiLimitConfig {
  return {
    perUserPer10Min: num(env.AI_RATE_LIMIT_PER_10MIN, 6),
    perUserPerDay: num(env.AI_DAILY_LIMIT_PER_USER, 40),
    globalPerDay: num(env.AI_DAILY_LIMIT_GLOBAL, 400),
  };
}

export class AiLimiter {
  private burst: WindowLimiter;
  private daily: WindowLimiter;
  private global: WindowLimiter;
  constructor(cfg: AiLimitConfig = aiLimitConfig()) {
    this.burst = new WindowLimiter(cfg.perUserPer10Min, 10 * 60_000);
    this.daily = new WindowLimiter(cfg.perUserPerDay, 24 * 3600_000);
    this.global = new WindowLimiter(cfg.globalPerDay, 24 * 3600_000);
  }
  /** Consomme une analyse. Retourne null si autorisée, sinon le message de refus et le délai conseillé. */
  take(user: string, now = Date.now()): { message: string; retryAfterSec: number } | null {
    const b = this.burst.hit(user, now);
    if (!b.allowed) return { message: 'Trop d’analyses en peu de temps. Réessayez dans quelques minutes.', retryAfterSec: b.retryAfterSec };
    const d = this.daily.hit(user, now);
    if (!d.allowed) return { message: 'Limite quotidienne d’analyses IA atteinte pour votre compte. Utilisez le rapport local ou réessayez demain.', retryAfterSec: d.retryAfterSec };
    const g = this.global.hit('*', now);
    if (!g.allowed) return { message: 'Limite quotidienne globale d’analyses IA atteinte. Utilisez le rapport local.', retryAfterSec: g.retryAfterSec };
    return null;
  }
}
