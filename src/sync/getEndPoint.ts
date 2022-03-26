export const syncRoute = '/html-node-sync';
export const statusRoute = '/status';

/**
 * Our custom endpoint that used to sync with the server
 */
export function getSyncEndPoint(ipAddress: string, port: number): string {
  return `http://${ipAddress}:${port}${syncRoute}`;
}

/**
 * Official status endpoint
 */
export function getStatusEndPoint(ipAddress: string, port: number): string {
  return `http://${ipAddress}:${port}${statusRoute}`;
}
