import { ITiddlerFieldsParam } from 'tiddlywiki';

export interface ISyncEndPointRequest {
  lastSync: string | undefined;
  tiddlers: Array<Partial<ITiddlerFieldsParam>>;
}

export interface IClientInfo {
  Origin: string;
  'User-Agent': string;
  state?: ConnectionState;
  timestamp: number;
}

export enum ConnectionState {
  offline = 'offline',
  /** once selected by the user, but now offlined */
  offlineActive = 'offlineActive',
  /** online and not selected by the user */
  online = 'online',
  /** online and selected by the user */
  onlineActive = 'onlineActive',
}
