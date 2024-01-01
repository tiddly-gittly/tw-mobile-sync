/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { OutputMimeTypes, ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

/**
 * Route to get things originally inside `<script class="tiddlywiki-tiddler-store" type="application/json">`
 * This will return a JSON Line file, each line is a tiddler json, no tailing comma, and is parsed in TidGi-Mobile's importer and store in SQLite (instead of in HTML).
 * Only including skinny tiddlers.
 *
 * Used in TidGi-Mobile's src/pages/Importer/useImportHTML.ts
 */
exports.path = /^\/tw-mobile-sync\/get-skinny-tiddlywiki-tiddler-store-script$/;

// intended to work with TidGi-Mobile, which can handle the lazy-all. Tiddloid is hard to implement this in Java code...
const templateName = '$:/plugins/linonetwo/tw-mobile-sync/templates/save/save-lazy-all-skinny-tiddler-store';

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  // const downloadType = (context.server.get('root-render-type') as OutputMimeTypes | undefined) ?? 'text/plain';
  const exportedHTMLContent = context.wiki.renderTiddler('text/plain', templateName);

  try {
    response.writeHead(200, { 'Content-Type': 'application/jsonl', 'Content-Length': Buffer.byteLength(exportedHTMLContent) });
    response.end(exportedHTMLContent, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to render tiddlers using ${templateName} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
