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
  const encodedTitlesFilter = (context.params as Record<string, string | undefined>)?.[0];
  let titlesFilter = '[!is[system]] -[type[application/javascript]] -[is[binary]]';
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
    response.writeHead(200, { 'Content-Type': 'application/json' });
    pipeline(
      titleStream,
      transformStream,
      response,
      (error) => {
        if (error !== null && error !== undefined) {
          console.error('Pipeline error:', error);
          // Don't send head after already send 200, otherwise cause "[ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client"
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          // Error may be undefined.
          response.end(`Failed to render tiddlers with stream , ${(error as Error)?.message} ${(error as Error)?.stack ?? ''}`);
        }
      },
    );
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    console.error('Catch error:', error);
    response.end(`Failed to render tiddlers in get-skinny-tiddler-text , ${(error as Error)?.message} ${(error as Error)?.stack ?? ''}`);
  }
};

exports.handler = handler;
