export const syncRoute = '/tw-mobile-sync/html-node-sync';
export const statusRoute = '/status';

/**
 * Our custom endpoint that used to sync with the server
 */
export function getSyncEndPoint(ipAddress: string, port: number): string {
  return `http://${ipAddress}:${port}${syncRoute}`;
}

export function getFilterServerEndPoint(ipAddress: string, port: number, filter: string): string {
  return `http://${ipAddress}:${port}/recipes/default/tiddlers.json?filter=${encodeURIComponent(filter)}`;
}

/**
 * Official status endpoint
 */
export function getStatusEndPoint(ipAddress: string, port: number): string {
  return `http://${ipAddress}:${port}${statusRoute}`;
}
