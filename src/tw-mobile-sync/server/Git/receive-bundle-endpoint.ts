import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { createGitRunner } from '../../git/gitRunnerFactory';
import { getWorkspaceRepoPath } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken, getTidGiService } from './utilities';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/receive-bundle$/;
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

      const requestBody = context.data as unknown as Buffer | undefined;
      if (!requestBody || requestBody.length === 0) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Empty bundle');
        return;
      }

      const contentType = (request as unknown as Http.IncomingMessage).headers['content-type'] ?? '';
      let bundleBuffer: Buffer;
      if (contentType.includes('base64')) {
        bundleBuffer = Buffer.from(requestBody.toString('utf8'), 'base64');
      } else {
        bundleBuffer = Buffer.isBuffer(requestBody) ? requestBody : Buffer.from(requestBody);
      }

      console.log('receive-bundle handler', {
        workspaceId,
        rawSize: requestBody.length,
        bundleSize: bundleBuffer.length,
      });

      const runner = createGitRunner(tidgiService, workspaceId);

      await runner.writeTempGitFile(repoPath, 'incoming.bundle', new Uint8Array(bundleBuffer));
      try {
        const verifyResult = await runner.run(['bundle', 'verify', '.git/incoming.bundle'], repoPath);
        if (verifyResult.exitCode !== 0) {
          throw new Error(`Bundle verify failed: ${verifyResult.stderr}`);
        }
        console.log('Bundle verified', { workspaceId, stdout: verifyResult.stdout.trim() });

        let sourceBranch = 'master';
        const listHeadsResult = await runner.run(['bundle', 'list-heads', '.git/incoming.bundle'], repoPath);
        if (listHeadsResult.exitCode === 0) {
          const match = /refs\/heads\/(\S+)/.exec(listHeadsResult.stdout);
          if (match?.[1]) sourceBranch = match[1];
        }
        console.log('Bundle source branch detected:', { workspaceId, sourceBranch });

        const fetchResult = await runner.run(
          ['fetch', '.git/incoming.bundle', `${sourceBranch}:mobile-incoming`],
          repoPath,
        );
        if (fetchResult.exitCode !== 0) {
          throw new Error(`Bundle fetch failed: ${fetchResult.stderr}`);
        }
        console.log('Bundle fetch complete', { workspaceId });
      } finally {
        await runner.deleteTempGitFile(repoPath, 'incoming.bundle').catch(() => {});
      }

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
