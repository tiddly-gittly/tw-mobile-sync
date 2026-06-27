import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { GitHTTPResponseChunk } from 'tidgi-shared';
import { createSpawnGitRunner } from '../../git/gitRunnerFactory';
import { handleReceivePack } from '../../git/smartHttp';
import { getWorkspaceRepoPath, isWorkspaceReadOnly } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken, getTidGiService } from './utilities';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;
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

      const tidgiService = getTidGiService();
      if (!(await authorizeWorkspaceToken(request, response, tidgiService?.workspace, workspaceId))) {
        return;
      }

      const repoPath = await getWorkspaceRepoPath(workspaceId, tidgiService?.workspace);
      if (!repoPath) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Workspace not found');
        return;
      }

      if (await isWorkspaceReadOnly(workspaceId, tidgiService?.workspace)) {
        response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' });
        response.end('Workspace is read-only');
        return;
      }

      const requestBody = context.data as unknown as Buffer | undefined;
      console.log('git-receive-pack handler', {
        workspaceId,
        bodySize: requestBody?.length ?? 0,
      });

      // Smart HTTP still needs a spawn-capable runner, but in TidGi Desktop it
      // should spawn the bundled git binary rather than rely on PATH.
      const runner = await createSpawnGitRunner(tidgiService);
      const response$ = handleReceivePack(runner, repoPath, new Uint8Array(requestBody ?? Buffer.alloc(0)));

      const subscription = response$.subscribe({
        next(chunk: GitHTTPResponseChunk) {
          if (chunk.type === 'headers') {
            response.writeHead(chunk.statusCode, chunk.headers);
          } else {
            response.write(Buffer.from(chunk.data));
          }
        },
        error(error: Error) {
          console.error('git-receive-pack Observable error:', error);
          if (!response.headersSent) {
            response.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          response.end((error).message);
        },
        complete() {
          if (!response.writableEnded) {
            response.end();
          }
        },
      });

      response.on('close', () => {
        subscription.unsubscribe();
      });
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
