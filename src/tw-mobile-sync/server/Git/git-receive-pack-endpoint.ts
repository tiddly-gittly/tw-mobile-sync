import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { GitHTTPResponseChunk, ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

/**
 * Access TidGi service proxies via $tw.tidgi.service (see git-info-references-endpoint.ts for details).
 */
const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Git Smart HTTP receive-pack endpoint (git push)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-receive-pack
 *
 * Write operation — requires authentication
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;

/**
 * TiddlyWiki reads the POST body before calling the handler.
 * "buffer" makes it available as a Buffer in context.data.
 */
exports.bodyFormat = 'buffer';
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const handler: ServerEndpointHandler = function handler(
  request: Http.ClientRequest & Http.InformationEvent,
  response: Http.ServerResponse,
  context,
) {
  void (async () => {
    try {
      const workspaceId = context.params[0];
      if (!workspaceId) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Missing workspace ID');
        return;
      }

      // Authenticate
      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }

      if (!(await authorizeWorkspaceToken(request, response, tidgiService.workspace, workspaceId))) {
        return;
      }

      if (!tidgiService.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // context.data is a Buffer populated by TiddlyWiki's bodyFormat="buffer" handling
      const requestBody = context.data as unknown as Buffer;
      console.log('git-receive-pack handler', {
        workspaceId,
        bodySize: requestBody?.length ?? 0,
      });
      const response$ = tidgiService.gitServer.gitSmartHTTPReceivePack$(workspaceId, new Uint8Array(requestBody));

      const subscription = response$.subscribe({
        next(chunk: GitHTTPResponseChunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error: Error) {
          console.error('git-receive-pack Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error as Error).message);
        },
        complete() {
          if (!response.writableEnded) {
            response.end();
          }
        },
      });

      // Clean up if client disconnects before Observable completes
      response.on('close', () => {
        subscription.unsubscribe();
      });
    } catch (error) {
      console.error('Error in git-receive-pack handler:', error);
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
