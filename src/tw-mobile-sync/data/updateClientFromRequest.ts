import type Http from 'http';
import { ConnectionState } from '../types';
import type { ClientInfoStore } from './clientInfoStoreClass';
import { getClientInfo } from './getClientInfo';

export function updateClientFromRequest(
  request: Http.ClientRequest & Http.InformationEvent,
  options?: { recentlySyncedString?: string; state?: ConnectionState },
): void {
  const userAgent = request.headers['user-agent'];
  if (userAgent === undefined || userAgent === '') return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { store }: { store: ClientInfoStore } = require('$:/plugins/linonetwo/tw-mobile-sync/clientInfoStore.js');
  const clientInfo = getClientInfo(request, options?.state ?? ConnectionState.onlineActive);
  store.updateClient(userAgent, {
    ...clientInfo,
    ...(options?.recentlySyncedString !== undefined ? { recentlySyncedString: options.recentlySyncedString } : {}),
  });
}
