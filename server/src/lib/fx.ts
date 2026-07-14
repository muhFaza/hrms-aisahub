// Live USD→IDR rate from the free open.er-api.com endpoint (no API key required).
// Returns IDR per 1 USD, or null on any failure (network, timeout, bad shape) so the
// caller can fall back to a manual rate (design §4 / Phase 5). Node 24 has global fetch.
export async function fetchUsdToIdrRate(): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[fx] rate fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { rates?: { IDR?: unknown } };
    const rate = data?.rates?.IDR;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      console.warn('[fx] rate fetch returned no usable IDR value');
      return null;
    }
    return rate;
  } catch (err) {
    console.error('[fx] rate fetch error:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
