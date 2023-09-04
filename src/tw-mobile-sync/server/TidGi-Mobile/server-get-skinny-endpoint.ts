/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { OutputMimeTypes, ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/get-skinny-html$/;

// intended to work with TidGi-Mobile, which can handle the lazy-all. Tiddloid is hard to implement this in Java code...
const templateName = '$:/plugins/linonetwo/tw-mobile-sync/templates/save/lazy-all';

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const downloadType = (context.server.get('root-render-type') as OutputMimeTypes | undefined) ?? 'text/plain';
  const exportedHTMLContent = context.wiki.renderTiddler(downloadType, templateName, {
    variables: {},
  });

  try {
    response.writeHead(200, {
      'Content-Type': (context.server.get('root-serve-type') as OutputMimeTypes | undefined) ?? downloadType,
      'Content-Length': Buffer.byteLength(exportedHTMLContent),
    });
    response.end(exportedHTMLContent, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
