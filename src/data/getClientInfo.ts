import type Http from 'http';
import { ConnectionState, IClientInfo } from '../types';

export function getClientInfo(request: Http.ClientRequest & Http.InformationEvent, state = ConnectionState.online): IClientInfo {
  return {
    Origin: request.rawHeaders[request.rawHeaders.indexOf('Origin') + 1] ?? request.rawHeaders[request.rawHeaders.indexOf('Referer') + 1],
    'User-Agent': request.rawHeaders[request.rawHeaders.indexOf('User-Agent') + 1],
    timestamp: Date.now(),
    state,
  };
}
