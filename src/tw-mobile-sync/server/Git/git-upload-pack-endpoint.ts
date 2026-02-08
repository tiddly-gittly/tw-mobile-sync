import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from '../../types/tidgi-global';
import { collectRequestBody } from './utilities';

// Access global service (works in both Node.js and TiddlyWiki plugin environment)
const globalService = globalThis as typeof globalThis & { service?: ITidGiGlobalService };

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Git Smart HTTP upload-pack endpoint (git fetch/pull)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-upload-pack
 *
 * Read-only — no authentication required
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-upload-pack$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

/**
 * Collect entire request body into a Buffer with size limit.
 * The buffer is then sent as Uint8Array through IPC (structured-clone safe).
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

      if (!globalService.service?.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Collect POST body, then pass through IPC as Uint8Array
      const requestBody = await collectRequestBody(request);
      const response$ = globalService.service.gitServer.gitSmartHTTPUploadPack$(workspaceId, new Uint8Array(requestBody));

      const subscription = response$.subscribe({
        next(chunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error) {
          console.error('git-upload-pack Observable error:', error);
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
