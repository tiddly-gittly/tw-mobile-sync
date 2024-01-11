/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

/**
 * Route to get things inside `<script class="tiddlywiki-tiddler-store" type="application/json">`
 * Only including non-skinny tiddlers. This JSON is used as-is, so should be a valid JSON, instead of JSON-Line.
 *
 * Used in TidGi-Mobile's src/pages/Importer/useImportHTML.ts
 * intended to work with TidGi-Mobile, which can handle the lazy-all. Tiddloid is hard to implement this in Java code...
 */
exports.path = /^\/tw-mobile-sync\/get-non-skinny-tiddlywiki-tiddler-store-script$/;

const templateName = '$:/plugins/linonetwo/tw-mobile-sync/templates/save/save-lazy-all-non-skinny-tiddlywiki-tiddler-store';

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  // const downloadType = (context.server.get('root-render-type') as OutputMimeTypes | undefined) ?? 'text/plain';
  const exportedHTMLContent = context.wiki.renderTiddler('text/plain', templateName);

  try {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(exportedHTMLContent) });
    response.end(exportedHTMLContent, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
