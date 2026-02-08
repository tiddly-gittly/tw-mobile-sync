/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { parseBasicAuth, sendAuthChallenge } from './utils';

exports.method = 'GET';

/**
 * Git Smart HTTP info/refs endpoint
 * Format: /tw-mobile-sync/git/{workspaceId}/info/refs?service=git-upload-pack
 *
 * This endpoint is called first by git clients to discover available refs
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/info\/refs$/;

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

    // Parse query string for service parameter
    const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);
    const service = url.searchParams.get('service');

    if (service === undefined || service === '' || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Invalid or missing service parameter');
      return;
    }

    // git-receive-pack (push) requires authentication
    if (service === 'git-receive-pack') {
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
    }

    // Delegate to Desktop git service
    if (!(global as any).service?.git?.handleInfoRefs) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Git service not available');
      return;
    }

    await (global as any).service.git.handleInfoRefs(workspaceId, service, request, response);

    console.error('Error in git-info-refs handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
