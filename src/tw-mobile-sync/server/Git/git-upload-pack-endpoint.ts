/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'POST';

/**
 * Git Smart HTTP upload-pack endpoint (git fetch/pull)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-upload-pack
 *
 * This endpoint handles git fetch/pull operations (read-only)
 * No authentication required for read operations
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-upload-pack$/;

const handler: ServerEndpointHandler = async function handler(
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  context,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Extract workspace ID from path
    const workspaceId = (context.params)?.[0];
    if (workspaceId === undefined || workspaceId === '') {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Missing workspace ID');
      return;
    }

    // Delegate to Desktop git service
    if (!(global as any).service?.git?.handleUploadPack) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Git service not available');
      return;
    }

    await (global as any).service.git.handleUploadPack(workspaceId, request, response);
  } catch (error) {
    console.error('Error in git-upload-pack handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
