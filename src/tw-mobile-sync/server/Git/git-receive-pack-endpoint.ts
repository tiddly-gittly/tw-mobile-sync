import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { IGitServerService, IGitService, IWorkspaceService } from 'tidgi-shared';
import { parseBasicAuth, sendAuthChallenge } from './utilities';

/**
 * Subset of TidGi global services needed by Git endpoints
 */
export interface ITidGiGlobalService {
  gitServer?: IGitServerService;
  workspace: IWorkspaceService;
  git: IGitService;
}

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
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

/**
 * Collect entire request body into a Buffer with size limit.
 */
const MAX_BODY_SIZE = 100 * 1024 * 1024; // 100MB limit
function collectRequestBody(request: Http.ClientRequest & Http.InformationEvent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    (request as unknown as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalSize += buf.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes limit`));
        return;
      }
      chunks.push(buf);
    });
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
      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }

      // Get workspace token (may be empty/undefined for anonymous access)
      const workspaceToken = await tidgiService.workspace.getWorkspaceToken(workspaceId);
      // If workspace has a token configured, require authentication
      if (workspaceToken !== undefined && workspaceToken !== '') {
        const credentials = parseBasicAuth(request.headers.authorization);
        if (credentials === undefined) {
          sendAuthChallenge(response);
          return;
        }
        const token = credentials.password === '' ? credentials.username : credentials.password;

        if (!(await tidgiService.workspace.validateWorkspaceToken(workspaceId, token))) {
          sendAuthChallenge(response);
          return;
        }
      }
      // If workspaceToken is empty/undefined, allow anonymous access (insecure mode)

      if (!tidgiService.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Collect POST body, then pass through IPC as Uint8Array
      const requestBody = await collectRequestBody(request);
      const response$ = tidgiService.gitServer.gitSmartHTTPReceivePack$(workspaceId, new Uint8Array(requestBody));

      const subscription = response$.subscribe({
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
