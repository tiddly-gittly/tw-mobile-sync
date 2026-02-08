/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { parseBasicAuth, sendAuthChallenge } from './utils';

exports.method = 'POST';

/**
 * Git Smart HTTP receive-pack endpoint (git push)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-receive-pack
 *
 * This endpoint handles git push operations (write operations)
 * Requires authentication
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;

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

    // Require authentication for push operations
    const authHeader = request.headers.authorization;
    const credentials = parseBasicAuth(authHeader);

    if (credentials === undefined) {
      sendAuthChallenge(response);
      return;
    }

    // Token can be in either username or password field
    const token = credentials.password === '' ? credentials.username : credentials.password;

    // Validate token using Desktop workspace service
    if (!(global as any).service?.workspace?.validateWorkspaceToken) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Workspace service not available');
      return;
    }

    const isValid = await (global as any).service.workspace.validateWorkspaceToken(workspaceId, token);
    if (!isValid) {
      sendAuthChallenge(response);
      return;
    }

    // Delegate to Desktop git service
    if (!(global as any).service?.git?.handleReceivePack) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Git service not available');
      return;
    }

    await (global as any).service.git.handleReceivePack(workspaceId, request, response);
  } catch (error) {
    console.error('Error in git-receive-pack handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
