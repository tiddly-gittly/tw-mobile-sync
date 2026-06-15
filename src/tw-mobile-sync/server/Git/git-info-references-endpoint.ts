import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { GitHTTPResponseChunk, ITidGiGlobalService } from 'tidgi-shared';
import { URL } from 'url';
import { handleInfoReferences } from '../../git/smartHttp';
import { SystemGitRunner } from '../../git/systemGitRunner';
import { getWorkspaceRepoPath } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken } from './utilities';

const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/info\/refs$/;
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

      const requestWithUrl = request as Http.ClientRequest & Http.InformationEvent & { url?: string };
      const url = new URL(requestWithUrl.url || '', `http://${request.headers.host || 'localhost'}`);
      const service = url.searchParams.get('service');

      if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Invalid or missing service parameter');
        return;
      }

      if (!(await authorizeWorkspaceToken(request, response, tidgiService?.workspace, workspaceId))) {
        return;
      }

      const repoPath = await getWorkspaceRepoPath(workspaceId, tidgiService?.workspace);
      if (!repoPath) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Workspace not found');
        return;
      }

      // Smart HTTP always spawns raw git processes, so it uses the system git runner.
      const runner = new SystemGitRunner();
      const response$ = handleInfoReferences(runner, repoPath, service);
      const subscription = response$.subscribe({
        next(chunk: GitHTTPResponseChunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error: Error) {
          console.error('git-info-refs Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error).message);
        },
        complete() {
          if (!response.writableEnded) response.end();
        },
      });

      response.on('close', () => {
        subscription.unsubscribe();
      });
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
