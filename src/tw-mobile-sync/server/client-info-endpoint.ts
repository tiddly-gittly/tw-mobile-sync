/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ClientInfoStore } from '../data/clientInfoStoreClass';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';
exports.path = /^\/tw-mobile-sync\/client-info$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const handler: ServerEndpointHandler = function handler(_request: Http.ClientRequest & Http.InformationEvent, response: Http.ServerResponse) {
  const clientInfoStore: ClientInfoStore = require('$:/plugins/linonetwo/tw-mobile-sync/clientInfoStore.js').store;
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(clientInfoStore.allClient), 'utf8');
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */