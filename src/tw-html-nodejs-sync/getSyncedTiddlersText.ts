import take from 'lodash/take';
import { ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';

export function getSyncedTiddlersText(
  changedTiddlersFromClient: Array<ITiddlerFieldsParam | ITiddlerFields>,
  changedTiddlersFromServer: Array<ITiddlerFieldsParam | ITiddlerFields>,
  deletion: { client: string[]; server: string[] },
  options?: { reverse?: boolean },
): string {
  const changedTitleDisplayLimit = 5;

  const formatList = (list: string[]): string => take(list, changedTitleDisplayLimit).join(' ');
  const moreCountText = (list: string[]): string => list.length > changedTitleDisplayLimit ? `And ${list.length - changedTitleDisplayLimit} more` : '';

  const clientTitles = changedTiddlersFromClient
    .map(tiddler => (tiddler.caption as string | undefined) || tiddler.title || '')
    .filter((title): title is string => typeof title === 'string' && title.length > 0);
  const clientText = formatList(clientTitles);
  const clientCount = moreCountText(clientTitles);

  const serverTitles = changedTiddlersFromServer
    .map(tiddler => (tiddler.caption as string | undefined) || tiddler.title || '')
    .filter((title): title is string => typeof title === 'string' && title.length > 0);
  const serverText = formatList(serverTitles);
  const serverCount = moreCountText(serverTitles);

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
