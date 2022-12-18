/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { ServerEndpointHandler } from 'tiddlywiki';
import type Http from 'http';
import type { ClientInfoStore } from '../data/clientInfoStoreClass';
import { getClientInfo } from '../data/getClientInfo';

exports.method = 'GET';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/status$/;

/** a /status endpoint with CORS (the original one will say CORS error) */
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest & Http.InformationEvent, response: Http.ServerResponse, context) {
  const clientInfo = getClientInfo(request);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const clientInfoStore: ClientInfoStore = require('$:/plugins/linonetwo/tw-mobile-sync/clientInfoStore.js').store;
  clientInfoStore.updateClient(clientInfo.Origin, clientInfo);
  // mostly copied from the official repo's core/modules/server/routes/get-status.js
  const text = JSON.stringify({
    username: context.authenticatedUsername ?? (context.server.get('anon-username') as string | undefined) ?? '',
    anonymous: !context.authenticatedUsername,
    read_only: !context.server.isAuthorized('writers', context.authenticatedUsername),
    space: {
      recipe: 'default',
    },
    tiddlywiki_version: $tw.version,
  });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(text, 'utf8');
};
exports.handler = handler;
