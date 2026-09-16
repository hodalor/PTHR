export const SESSION_WARM_CACHE_PREFIX = 'pthr:warm-cache';
export const SESSION_WARM_CACHE_TTL_MS = 1000 * 60 * 5;

export const buildWarmCacheStorageKey = (scope) => `${SESSION_WARM_CACHE_PREFIX}:${scope}`;

export const readWarmCache = (scope) => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(buildWarmCacheStorageKey(scope));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (Number(parsed.expiresAt || 0) <= Date.now()) {
      window.sessionStorage.removeItem(buildWarmCacheStorageKey(scope));
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
};

export const writeWarmCache = (scope, payload, ttlMs = SESSION_WARM_CACHE_TTL_MS) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      buildWarmCacheStorageKey(scope),
      JSON.stringify({
        payload,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
      })
    );
  } catch (_error) {
  }
};
