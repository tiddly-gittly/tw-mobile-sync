import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { GitHTTPResponseChunk, ITidGiGlobalService } from 'tidgi-shared';
import { URL } from 'url';
import { authorizeWorkspaceToken } from './utilities';

/**
 * Access TidGi service proxies via $tw.tidgi.service.
 * TiddlyWiki route modules run inside a vm.runInContext sandbox where
 * globalThis/global point to an empty V8 context — NOT the worker's real globalThis.
 * Only $tw (injected as a sandbox parameter) is available, so TidGi-Desktop
 * attaches its IPC service proxies as $tw.tidgi.service before boot.
 */
const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';

/**
 * Git Smart HTTP info/refs endpoint
 * Format: /tw-mobile-sync/git/{workspaceId}/info/refs?service=git-upload-pack
 *
 * This endpoint is called first by git clients to discover available refs
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/info\/refs$/;
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

      // Parse ?service= query param
      const requestWithUrl = request as Http.ClientRequest & Http.InformationEvent & { url?: string };
      const url = new URL(requestWithUrl.url || '', `http://${request.headers.host || 'localhost'}`);
      const service = url.searchParams.get('service');

      if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Invalid or missing service parameter');
        return;
      }

      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }

      if (!(await authorizeWorkspaceToken(request, response, tidgiService.workspace, workspaceId))) {
        return;
      }

      if (!tidgiService?.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Subscribe to Observable — IPC streams response chunks back to this worker
      const response$ = tidgiService.gitServer.gitSmartHTTPInfoRefs$(workspaceId, service);
      const subscription = response$.subscribe({
        next(chunk: GitHTTPResponseChunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error: Error) {
          console.error('git-info-refs Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error as Error).message);
        },
        complete() {
          if (!response.writableEnded) response.end();
        },
      });

      // Clean up if client disconnects before Observable completes
      response.on('close', () => {
        subscription.unsubscribe();
      });
    } catch (error) {
      console.error('Error in git-info-refs handler:', error);
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
