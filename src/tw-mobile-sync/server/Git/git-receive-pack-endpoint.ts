import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from '../../types/tidgi-global';
import { parseBasicAuth, sendAuthChallenge } from './utilities';

declare const global: typeof globalThis & { service?: ITidGiGlobalService };

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Git Smart HTTP receive-pack endpoint (git push)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-receive-pack
 *
 * Write operation — requires authentication
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

/**
 * Collect entire request body into a Buffer.
 */
function collectRequestBody(request: Http.ClientRequest & Http.InformationEvent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (request as unknown as NodeJS.ReadableStream).on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    (request as unknown as NodeJS.ReadableStream).on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    (request as unknown as NodeJS.ReadableStream).on('error', reject);
  });
}

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

      // Authenticate
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

      if (!global.service?.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Collect POST body, then pass through IPC as Uint8Array
      const requestBody = await collectRequestBody(request);
      const response$ = global.service.gitServer.gitSmartHTTPReceivePack$(workspaceId, new Uint8Array(requestBody));

      response$.subscribe({
        next(chunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error) {
          console.error('git-receive-pack Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error).message);
        },
        complete() {
          if (!response.writableEnded) response.end();
        },
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
