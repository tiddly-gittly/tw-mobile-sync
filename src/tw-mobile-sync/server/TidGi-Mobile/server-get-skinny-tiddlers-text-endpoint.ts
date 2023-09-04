/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

/**
 * Sync text field for most of small skinny tiddlers.
 * Return multiple tiddler at once, for TidGi-Mobile to batch update. But only limit to small files smaller than 0.5MB.
 */
exports.path = /^\/tw-mobile-sync\/get-skinny-tiddler-text$/;

const templateName = '$:/plugins/linonetwo/tw-mobile-sync/templates/save/save-lazy-all-skinny-tiddler-store';

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  // get filter for titles
  const titlesFilter = '[!is[system]] -[type[application/javascript]] -[is[binary]]';
  const titles = context.wiki.filterTiddlers(titlesFilter);
  // get tiddlers
  const texts = titles.map(title => context.wiki.getTiddlerText(title));
  const result = JSON.stringify(titles.map((title, index) => ({ title, text: texts[index] })));

  try {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(result) });
    response.end(result, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
