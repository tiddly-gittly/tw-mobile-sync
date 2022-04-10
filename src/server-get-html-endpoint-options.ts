import type { ServerEndpointHandler } from 'tiddlywiki';
import type Http from 'http';

/** this route is adding CORS to the POST in same route */
exports.method = 'OPTIONS';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/get-full-html$/;

// TODO: use this custom endpoint to handle conflict on server side
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.writeHead(200);
  response.end();
};

exports.handler = handler;
