import type Http from 'http';
import { ConnectionState, IClientInfo } from '../types';

export function getClientInfo(request: Http.ClientRequest & Http.InformationEvent, state = ConnectionState.online): Partial<IClientInfo> {
  return {
    Origin: request.headers.origin ?? request.headers.referer,
    'User-Agent': request.headers['user-agent'],
    timestamp: Date.now(),
    state,
  };
}
