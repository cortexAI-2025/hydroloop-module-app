/**
 * Limiteurs en mémoire (par instance serveur).
 * Suffisant pour une exploitation mono-instance ; en serverless multi-instances la limite est approximative
 * (documenté dans docs/SECURITE.md) — ajouter un magasin partagé (Redis/Upstash) si le risque l'exige.
 */

export interface LimitResult { allowed: boolean; remaining: number; retryAfterSec: number }

export class WindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  hit(key: string, now = Date.now()): LimitResult {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.gc(now);
    return { allowed: true, remaining: this.max - arr.length, retryAfterSec: 0 };
  }

  reset(key: string) { this.hits.delete(key); }
  private gc(now: number) { for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k); }
}

/** Verrouille une clé après N échecs consécutifs pendant `lockMs`. */
export class FailureLimiter {
  private fails = new Map<string, { n: number; until: number; first: number }>();
  constructor(private maxFails = 5, private lockMs = 15 * 60_000) {}

  isLocked(key: string, now = Date.now()): boolean {
    const f = this.fails.get(key);
    if (!f) return false;
    if (f.until && now < f.until) return true;
    if (f.until && now >= f.until) this.fails.delete(key);
    return false;
  }

  fail(key: string, now = Date.now()) {
    const f = this.fails.get(key) ?? { n: 0, until: 0, first: now };
    f.n += 1;
    if (f.n >= this.maxFails) f.until = now + this.lockMs;
    this.fails.set(key, f);
  }

  success(key: string) { this.fails.delete(key); }
}
