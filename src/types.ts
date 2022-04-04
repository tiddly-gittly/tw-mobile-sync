import { ITiddlerFields } from 'tiddlywiki';

export interface ISyncEndPointRequest {
  tiddlers: ITiddlerFields[];
  lastSync: string | undefined;
}
