/* eslint-disable unicorn/prevent-abbreviations */
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
      // Extract workspace ID from path
      const workspaceId = context.params[0];
      if (!workspaceId) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Missing workspace ID');
        return;
      }

      // Parse query string for service parameter
      // TiddlyWiki's ClientRequest has url property but not in type definition
      const requestWithUrl = request as Http.ClientRequest & Http.InformationEvent & { url?: string };
      const requestUrl = requestWithUrl.url || '';
      const requestHost = request.headers.host || 'localhost';
      const url = new URL(requestUrl, `http://${requestHost}`);
      const service = url.searchParams.get('service');

      if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
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
      }

      // Delegate to Desktop git service
      if (!global.service) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('TidGi service not available');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!global.service.git.handleInfoRefs) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git service not available');
        return;
      }

      // Convert TiddlyWiki's ClientRequest to Node's IncomingMessage for Desktop service
      await global.service.git.handleInfoRefs(workspaceId, service, request as unknown as Http.IncomingMessage, response);
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
