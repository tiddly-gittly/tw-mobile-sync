import type { ServerEndpointHandler, Tiddler } from 'tiddlywiki';
import type Http from 'http';

exports.method = 'POST';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/html-node-sync$/;

// TODO: use this custom endpoint to handle conflict on server side
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  const tiddlers: Tiddler[] = $tw.utils.parseJSONSafe(context.data);
  // DEBUG: console
  console.log(`tiddlers`, tiddlers);
  if (!Array.isArray(tiddlers)) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(`Bad request body, not a tiddler list. ${String(tiddlers)}`, 'utf8');
  }
  try {
    context.wiki.addTiddlers(tiddlers);
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ aaa: 'aaa' }), 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to add tiddlers ${(error as Error).message} ${(error as Error).stack}`, 'utf8');
  }
};
exports.handler = handler;
