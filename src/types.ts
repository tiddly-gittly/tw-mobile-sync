import { ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';

export interface ISyncEndPointRequest {
  lastSync: string | undefined;
  tiddlers: Array<Partial<ITiddlerFieldsParam> | Partial<ITiddlerFields>>;
}
