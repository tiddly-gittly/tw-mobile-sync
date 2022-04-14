import type { ServerEndpointHandler, Tiddler } from 'tiddlywiki';
import type Http from 'http';
import { ISyncEndPointRequest } from '../types';
import { getDiffFilter } from '../filters';

exports.method = 'POST';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/html-node-sync$/;

// TODO: use this custom endpoint to handle conflict on server side
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const { tiddlers, lastSync } = $tw.utils.parseJSONSafe(context.data) as ISyncEndPointRequest;
  if (!Array.isArray(tiddlers)) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(`Bad request body, not a tiddler list. ${String(tiddlers)}`, 'utf8');
  }
  // get changed tiddlers
  const diffTiddlersFilter: string = getDiffFilter(lastSync);
  const diffTiddlers: string[] = $tw.wiki.compileFilter(diffTiddlersFilter)() ?? [];
  const changedTiddlersFromServer = diffTiddlers
    .map((title) => {
      return $tw.wiki.getTiddler(title);
    })
    .filter((i): i is Tiddler => i !== undefined)
    .map((tiddler) => tiddler.fields);

  try {
    // TODO: trigger client fetch changes using server sent event, see https://github.com/Jermolene/TiddlyWiki5/pull/5279
    context.wiki.addTiddlers(tiddlers);
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(changedTiddlersFromServer), 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to add tiddlers ${(error as Error).message} ${(error as Error).stack}`, 'utf8');
  }
};

exports.handler = handler;
