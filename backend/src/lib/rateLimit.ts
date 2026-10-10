export interface RateLimiter {
  /** Records one use for `key` and returns true, or returns false (recording nothing) when over the limit. */
  take: (key: string) => boolean;
}

/**
 * Sliding-window limiter: at most `limit` uses per `key` in any `windowMs`.
 * shortcut: per-process; move to a shared store when running more than one server.
 * It limits one user's request rate. It is NOT a guard for the provider's daily quota.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now: () => Date;
}): RateLimiter {
  const { limit, windowMs, now } = options;
  const uses = new Map<string, number[]>();

  return {
    take(key) {
      const t = now().getTime();
      const recent = (uses.get(key) ?? []).filter((at) => at > t - windowMs);
      if (recent.length >= limit) {
        uses.set(key, recent);
        return false;
      }
      recent.push(t);
      uses.set(key, recent);
      return true;
    },
  };
}

/**
 * Per-user AI calls: note analysis and Ask AI share one allowance. Kept under Gemini's free-tier
 * 5 requests/minute so one failed call's retry still fits; raise it with a paid tier.
 */
export const AI_CALLS_PER_MINUTE = 4;
