import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from '../../types/tidgi-global';
import { parseBasicAuth, sendAuthChallenge } from './utilities';

declare const global: typeof globalThis & { service?: ITidGiGlobalService };

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
  response.setHeader('Access-Control-Allow-Origin', '*');

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

      // git-receive-pack (push) requires authentication
      if (service === 'git-receive-pack') {
        const credentials = parseBasicAuth(request.headers.authorization);
        if (credentials === undefined) {
          sendAuthChallenge(response);
          return;
        }
        const token = credentials.password === '' ? credentials.username : credentials.password;

        if (!global.service?.workspace) {
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end('Workspace service not available');
          return;
        }
        if (!(await global.service.workspace.validateWorkspaceToken(workspaceId, token))) {
          sendAuthChallenge(response);
          return;
        }
      }

      if (!global.service?.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Subscribe to Observable — IPC streams response chunks back to this worker
      const response$ = global.service.gitServer.gitSmartHTTPInfoRefs$(workspaceId, service);
      const subscription = response$.subscribe({
        next(chunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error) {
          console.error('git-info-refs Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error).message);
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
