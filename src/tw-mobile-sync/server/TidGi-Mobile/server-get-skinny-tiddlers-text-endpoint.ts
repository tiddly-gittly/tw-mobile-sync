/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import { pipeline, Readable, Transform } from 'stream';
import type { ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

/**
 * Sync text field for most of small skinny tiddlers.
 * Return multiple tiddler at once, for TidGi-Mobile to batch update. But only limit to small files smaller than 0.5MB.
 *
 * Used in TidGi-Mobile's src/pages/Importer/useImportHTML.ts
 */
exports.path = /^\/tw-mobile-sync\/get-skinny-tiddler-text\/(.+)$/;

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  // get filter for titles
  const encodedTitlesFilter = context.params?.[0];
  let titlesFilter =
    '[!is[system]] -[type[application/javascript]] -[is[binary]] -[is[binary]] -[type[application/msword]] -[type[application/excel]] -[type[application/mspowerpoint]] -[type[application/vnd.ms-excel]]';
  if (encodedTitlesFilter?.trim?.()) {
    titlesFilter = $tw.utils.decodeURIComponentSafe(encodedTitlesFilter).trim();
  }

  const titles = context.wiki.filterTiddlers(titlesFilter);
  // get tiddlers
  const titleStream = Readable.from(titles);
  const transformStream = new Transform({
    objectMode: true,
    transform(title: string, encoding, callback) {
      callback(null, JSON.stringify({ title, text: context.wiki.getTiddlerText(title) }) + '\n');
    },
  });

  try {
    response.writeHead(200, { 'Content-Type': 'application/json' }); // , 'Content-Length': Buffer.byteLength(result) });
    pipeline(
      titleStream,
      transformStream,
      response,
      (error) => {
        if (error !== null) {
          response.writeHead(500);
          response.end(`Failed to render tiddlers with stream , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
        }
      },
    );
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers in get-skinny-tiddler-text , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
