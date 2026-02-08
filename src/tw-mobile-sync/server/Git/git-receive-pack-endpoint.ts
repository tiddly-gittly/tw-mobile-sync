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
 * This endpoint handles git push operations (write operations)
 * Requires authentication
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;
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
      if (!global.service) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('TidGi service not available');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!global.service.workspace.validateWorkspaceToken) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }

      const isValid = await global.service.workspace.validateWorkspaceToken(workspaceId, token);
      if (!isValid) {
        sendAuthChallenge(response);
        return;
      }

      // Delegate to Desktop git service
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!global.service.git.handleReceivePack) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git service not available');
        return;
      }

      // Convert TiddlyWiki's ClientRequest to Node's IncomingMessage for Desktop service
      await global.service.git.handleReceivePack(workspaceId, request as unknown as Http.IncomingMessage, response);
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
