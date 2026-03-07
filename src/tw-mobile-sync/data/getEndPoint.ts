export const clientInfoRoute = '/tw-mobile-sync/client-info';

/** Used for NodeJS server's client page get info from the same origin */
export function getClientInfoPoint(baseUrl?: string): string {
  const originFallback = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const normalizedBaseUrl = new URL(baseUrl ?? originFallback, originFallback);
  return new URL(clientInfoRoute, `${normalizedBaseUrl.origin}/`).toString();
}
