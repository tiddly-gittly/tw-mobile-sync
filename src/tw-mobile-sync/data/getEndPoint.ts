export const clientInfoRoute = 'tw-mobile-sync/client-info';

/** Used for NodeJS server's client page get info from the same origin */
export function getClientInfoPoint(baseUrl?: string): string {
  const rawBaseUrl = baseUrl ?? location.origin;
  const normalizedBaseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  return `${normalizedBaseUrl}/${clientInfoRoute}`;
}
