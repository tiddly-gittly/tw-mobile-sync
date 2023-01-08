/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import take from 'lodash/take';
import { ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';

export function getSyncedTiddlersText(
  changedTiddlersFromClient: Array<ITiddlerFieldsParam | ITiddlerFields>,
  changedTiddlersFromServer: Array<ITiddlerFieldsParam | ITiddlerFields>,
  options?: { reverse?: boolean },
) {
  const changedTitleDisplayLimit = 5;
  const clientText = take(changedTiddlersFromClient, changedTitleDisplayLimit)
    .map((tiddler) => tiddler.caption ?? (tiddler.title as string))
    .join(' ');
  const clientCount =
    changedTiddlersFromClient.length > changedTitleDisplayLimit ? `And ${changedTiddlersFromClient.length - changedTitleDisplayLimit} more` : '';
  const serverText = take(changedTiddlersFromServer, changedTitleDisplayLimit)
    .map((tiddler) => tiddler.caption ?? (tiddler.title as string))
    .join(' ');
  const serverCount =
    changedTiddlersFromServer.length > changedTitleDisplayLimit ? `And ${changedTiddlersFromServer.length - changedTitleDisplayLimit} more` : '';
  const up = options?.reverse ? '↓' : '↑';
  const down = options?.reverse ? '↑' : '↓';
  return `${up} ${changedTiddlersFromClient.length} ${down} ${changedTiddlersFromServer.length}${
    changedTiddlersFromClient.length > 0 ? `\n\n${up}: ${clientText} ${clientCount}` : ''
  }${changedTiddlersFromServer.length > 0 ? `\n\n${down}: ${serverText} ${serverCount}` : ''}`;
}
