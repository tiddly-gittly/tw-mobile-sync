/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ClientInfoStore } from '../../data/clientInfoStoreClass';

exports.method = 'GET';

exports.path = /^\/tw-html-nodejs-sync\/client-info$/;

/** a /status endpoint with CORS (the original one will say CORS error) */
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest & Http.InformationEvent, response: Http.ServerResponse, context) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const clientInfoStore: ClientInfoStore = require('$:/plugins/linonetwo/tw-html-nodejs-sync/clientInfoStore.js').store;
  // mostly copied from the official repo's core/modules/server/routes/get-status.js
  const text = JSON.stringify(clientInfoStore.allClient);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(text, 'utf8');
};
exports.handler = handler;
