import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

/**
 * Access TidGi service proxies via $tw.tidgi.service (see git-info-references-endpoint.ts for details).
 */
const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Git bundle receive endpoint (alternative to git-receive-pack for mobile push).
 *
 * Mobile client creates a git bundle containing unpushed commits using JGit BundleWriter,
 * then HTTP POSTs it here. Desktop uses `git fetch <bundle> master:mobile-incoming`
 * to import the commits into the mobile-incoming branch.
 *
 * This avoids JGit's SmartHttpPushConnection bug where MultiRequestService
 * throws "Starting read stage without written request data pending is not supported".
 *
 * Format: /tw-mobile-sync/git/{workspaceId}/receive-bundle
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/receive-bundle$/;

/**
 * TiddlyWiki reads the POST body before calling the handler.
 * "buffer" makes it available as a Buffer in context.data.
 */
exports.bodyFormat = 'buffer';
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

      // Authenticate
      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }

      if (!(await authorizeWorkspaceToken(request, response, tidgiService.workspace, workspaceId))) {
        return;
      }

      if (!tidgiService.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      const requestBody = context.data as unknown as Buffer | undefined;
      if (!requestBody || requestBody.length === 0) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Empty bundle');
        return;
      }

      console.log('receive-bundle handler', {
        workspaceId,
        bundleSize: requestBody.length,
      });

      await tidgiService.gitServer.receiveBundleAndFetch(workspaceId, new Uint8Array(requestBody));

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    } catch (error) {
      console.error('Error in receive-bundle handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Bundle receive failed: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
