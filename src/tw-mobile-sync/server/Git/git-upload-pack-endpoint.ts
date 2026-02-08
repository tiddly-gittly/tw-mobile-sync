import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from '../../types/tidgi-global';

declare const global: typeof globalThis & { service?: ITidGiGlobalService };

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Git Smart HTTP upload-pack endpoint (git fetch/pull)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-upload-pack
 *
 * This endpoint handles git fetch/pull operations (read-only)
 * No authentication required for read operations
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-upload-pack$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const handler: ServerEndpointHandler = function handler(
  request: Http.ClientRequest & Http.InformationEvent,
  response: Http.ServerResponse,
  context,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  void (async () => {
    try {
      // Extract workspace ID from path
      const workspaceId = context.params[0];
      if (!workspaceId) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Missing workspace ID');
        return;
      }

      // Delegate to Desktop git service
      if (!global.service) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('TidGi service not available');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!global.service.git.handleUploadPack) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git service not available');
        return;
      }

      // Convert TiddlyWiki's ClientRequest to Node's IncomingMessage for Desktop service
      await global.service.git.handleUploadPack(workspaceId, request as unknown as Http.IncomingMessage, response);
    } catch (error) {
      console.error('Error in git-upload-pack handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Internal server error: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
