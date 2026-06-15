import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { GitHTTPResponseChunk, ITidGiGlobalService } from 'tidgi-shared';
import { handleUploadPack } from '../../git/smartHttp';
import { SystemGitRunner } from '../../git/systemGitRunner';
import { getWorkspaceRepoPath } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken } from './utilities';

const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-upload-pack$/;
exports.bodyFormat = 'buffer';
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const handler: ServerEndpointHandler = function handler(
  _request: Http.ClientRequest & Http.InformationEvent,
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

      if (!(await authorizeWorkspaceToken(_request, response, tidgiService?.workspace, workspaceId))) {
        return;
      }

      const repoPath = await getWorkspaceRepoPath(workspaceId, tidgiService?.workspace);
      if (!repoPath) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Workspace not found');
        return;
      }

      const requestBody = context.data as unknown as Buffer | undefined;
      console.log('git-upload-pack handler', {
        workspaceId,
        bodySize: requestBody?.length ?? 0,
      });

      // Smart HTTP always spawns raw git processes, so it uses the system git runner.
      const runner = new SystemGitRunner();
      const response$ = handleUploadPack(runner, repoPath, new Uint8Array(requestBody ?? Buffer.alloc(0)));

      const subscription = response$.subscribe({
        next(chunk: GitHTTPResponseChunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error: Error) {
          console.error('git-upload-pack Observable error:', { workspaceId, message: error.message });
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error).message);
        },
        complete() {
          console.log('git-upload-pack response complete', { workspaceId });
          if (!response.writableEnded) response.end();
        },
      });

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
