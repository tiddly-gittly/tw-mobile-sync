import type { ServerEndpointHandler } from 'tiddlywiki';
import type Http from 'http';

exports.method = 'GET';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/get-full-html$/;

// TODO: move to /server folder
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  // lazy image ?? $:/plugins/tiddlywiki/tiddlyweb/save/offline
  const templateName: string =
    context.server.get('root-tiddler') ?? context.wiki.getTiddlerText('$:/config/SaveWikiButton/Template', '$:/core/save/all').trim();

  const downloadType = context.server.get('root-render-type') ?? 'text/plain';
  const exportedHTMLContent = context.wiki.renderTiddler(downloadType, templateName);

  try {
    response.writeHead(200, { 'Content-Type': context.server.get('root-serve-type') ?? downloadType });
    response.end(exportedHTMLContent, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack}`, 'utf8');
  }
};

exports.handler = handler;
