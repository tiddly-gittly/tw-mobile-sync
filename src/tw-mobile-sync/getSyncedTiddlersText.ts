/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import take from 'lodash/take';
import { ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';

export function getSyncedTiddlersText(
  changedTiddlersFromClient: Array<ITiddlerFieldsParam | ITiddlerFields>,
  changedTiddlersFromServer: Array<ITiddlerFieldsParam | ITiddlerFields>,
  deletion: { client: string[]; server: string[] },
  options?: { reverse?: boolean },
) {
  const changedTitleDisplayLimit = 5;

  const formatList = (list: string[]) => take(list, changedTitleDisplayLimit).join(' ');
  const moreCountText = (list: string[]) => list.length > changedTitleDisplayLimit ? `And ${list.length - changedTitleDisplayLimit} more` : '';

  const clientText = formatList(changedTiddlersFromClient.map(tiddler => tiddler.caption as string ?? (tiddler.title)));
  const clientCount = moreCountText(changedTiddlersFromClient.map(item => item.title as string));
  const serverText = formatList(changedTiddlersFromServer.map(tiddler => tiddler.caption as string ?? (tiddler.title)));
  const serverCount = moreCountText(changedTiddlersFromServer.map(item => item.title as string));

  const deletionClientText = formatList(deletion.client);
  const deletionClientCount = moreCountText(deletion.client);
  const deletionServerText = formatList(deletion.server);
  const deletionServerCount = moreCountText(deletion.server);

  const up = options?.reverse ? '↓' : '↑';
  const down = options?.reverse ? '↑' : '↓';

  return `${up} ${changedTiddlersFromClient.length} ${down} ${changedTiddlersFromServer.length}${
    changedTiddlersFromClient.length > 0 ? `\n\n${up}: ${clientText} ${clientCount}` : ''
  }${changedTiddlersFromServer.length > 0 ? `\n\n${down}: ${serverText} ${serverCount}` : ''}${
    deletion.client.length > 0 ? `\n\nDeleted on Client: ${deletionClientText} ${deletionClientCount}` : ''
  }${deletion.server.length > 0 ? `\n\nDeleted on Server: ${deletionServerText} ${deletionServerCount}` : ''}`;
}
