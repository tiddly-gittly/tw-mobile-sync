import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

/**
 * Access TidGi service proxies via $tw.tidgi.service (see git-info-references-endpoint.ts for details).
 */
const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/**
 * Per-workspace merge mutex: reject concurrent merge requests for the same workspace.
 * Two phones syncing at the same time, or rapid clicks, will get 409 Conflict.
 */
const activeMerges = new Set<string>();

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Merge mobile-incoming branch into main after a push.
 * Mobile calls this AFTER pushing to mobile-incoming via receive-pack.
 * Desktop performs the merge + .tid-aware conflict resolution, then responds.
 * Format: /tw-mobile-sync/git/{workspaceId}/merge-incoming
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/merge-incoming$/;
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

      // Authenticate (same as receive-pack — write operation)
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

      if (activeMerges.has(workspaceId)) {
        response.writeHead(409, { 'Content-Type': 'text/plain' });
        response.end('Merge already in progress for this workspace');
        return;
      }

      activeMerges.add(workspaceId);
      try {
        await tidgiService.gitServer.mergeAfterPush(workspaceId);
      } finally {
        activeMerges.delete(workspaceId);
      }

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    } catch (error) {
      console.error('Error in merge-incoming handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Merge failed: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
