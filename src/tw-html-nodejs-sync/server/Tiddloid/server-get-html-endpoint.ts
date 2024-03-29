/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { OutputMimeTypes, ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-html-nodejs-sync\/get-full-html$/;

// don't use $:/core/save/lazy-images, otherwise image won't show in HTML
// don't use $:/plugins/tiddlywiki/tiddlyweb/save/offline , otherwise `TypeError: undefined is not an object (evaluating '$tw.syncer.syncadaptor')`
const templateName = '$:/core/save/all';

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const downloadType = (context.server.get('root-render-type') as OutputMimeTypes | undefined) ?? 'text/plain';
  const exportedHTMLContent = context.wiki.renderTiddler(downloadType, templateName, {
    variables: {
      // exclude large file and unused tiddlers, like `core/ui/DownloadFullWiki.tid`
      publishFilter:
        '-[type[application/msword]] -[type[application/pdf]] -[[$:/plugins/tiddlywiki/filesystem]] -[[$:/plugins/tiddlywiki/tiddlyweb]] -[[$:/plugins/twcloud/tiddlyweb-sse]]',
    },
  });

  try {
    response.writeHead(200, { 'Content-Type': (context.server.get('root-serve-type') as OutputMimeTypes | undefined) ?? downloadType });
    response.end(exportedHTMLContent, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
