export const clientInfoRoute = 'tw-mobile-sync/client-info';

/** Used for NodeJS server's client page get info from the same origin */
export function getClientInfoPoint(baseUrl?: string): string {
  return `${baseUrl ?? location.host}${clientInfoRoute}`;
}
