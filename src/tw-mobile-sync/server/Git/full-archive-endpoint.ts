import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { createGitRunner } from '../../git/gitRunnerFactory';
import { generateFullArchive } from '../../git/mobileSyncGit';
import { getWorkspaceRepoPath } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken, getTidGiService } from './utilities';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/full-archive$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const handler: ServerEndpointHandler = function handler(
  request: Http.ClientRequest & Http.InformationEvent,
  response: Http.ServerResponse,
  context,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');

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

      const runner = createGitRunner(tidgiService, workspaceId);
      const result = await generateFullArchive(runner, repoPath);
      if (!result) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Workspace not found or archive generation failed');
        return;
      }

      const { archivePath, commitHash, sizeBytes } = result;

      // Common headers for both full and partial responses
      const commonHeaders: Record<string, string> = {
        'Content-Type': 'application/x-tar',
        'Accept-Ranges': 'bytes',
        ETag: `"${commitHash}"`,
        'Cache-Control': 'no-cache',
        'X-Commit-Hash': commitHash,
      };

      // Handle Range request for resumable downloads
      const rangeHeader = (request as unknown as { headers: Record<string, string | undefined> }).headers.range;
      if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
        const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (rangeMatch) {
          const start = Number.parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : sizeBytes - 1;

          if (start >= sizeBytes || end >= sizeBytes || start > end) {
            response.writeHead(416, {
              ...commonHeaders,
              'Content-Range': `bytes */${sizeBytes}`,
            });
            response.end();
            return;
          }

          const contentLength = end - start + 1;
          response.writeHead(206, {
            ...commonHeaders,
            'Content-Range': `bytes ${start}-${end}/${sizeBytes}`,
            'Content-Length': String(contentLength),
          });

          // Stream the requested range
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const nodeFs = require('fs') as typeof import('fs');
          const stream = nodeFs.createReadStream(archivePath, { start, end });
          stream.pipe(response);
          stream.on('error', (error: Error) => {
            console.error('Stream error during range request:', error);
            if (!response.writableEnded) response.end();
          });
          return;
        }
      }

      // Full download (no Range header)
      response.writeHead(200, {
        ...commonHeaders,
        'Content-Length': String(sizeBytes),
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('fs') as typeof import('fs');
      const stream = nodeFs.createReadStream(archivePath);
      stream.pipe(response);
      stream.on('error', (error: Error) => {
        console.error('Stream error during full download:', error);
        if (!response.writableEnded) response.end();
      });
    } catch (error) {
      console.error('Error in full-archive handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Archive generation failed: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
