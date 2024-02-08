export const syncRoute = '/tw-html-nodejs-sync/html-node-sync';
export const statusRoute = '/tw-html-nodejs-sync/status';
export const clientInfoRoute = '/tw-html-nodejs-sync/client-info';
export const fullHtmlRoute = '/tw-html-nodejs-sync/get-full-html';

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

/** Used for NodeJS server's client page get info from the same origin */
export function getClientInfoPoint(): string {
  return `http://${location.host}${clientInfoRoute}`;
}

export function getFullHtmlEndPoint(ipAddress: string, port: number): string {
  return `http://${location.host}${fullHtmlRoute}`;
}
