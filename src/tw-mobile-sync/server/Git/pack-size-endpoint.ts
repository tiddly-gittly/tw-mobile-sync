import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/pack-size$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

/**
 * Returns an **estimate** of the bytes a shallow clone will transfer.
 *
 * Mobile uses this to abort early when the pack would exceed the device's
 * available JVM heap (~80-100 MB on mid-range Android).  The estimate is
 * computed from the size-pack value reported by `git count-objects -v` on the
 * repo backing the requested workspace.
 *
 * Response: `{ estimatedBytes: number }`
 */
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
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Missing workspace ID' }));
        return;
      }

      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Workspace service not available' }));
        return;
      }

      if (!(await authorizeWorkspaceToken(request, response, tidgiService.workspace, workspaceId))) {
        return;
      }

      // Get the wiki storage path for this workspace.
      const wikiFolderLocation = await (tidgiService.workspace as unknown as { getWikiFolderLocation: (workspaceId: string) => Promise<string | undefined> }).getWikiFolderLocation(
        workspaceId,
      );
      if (!wikiFolderLocation) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Workspace folder not found' }));
        return;
      }

      // Run `git count-objects -v` to get pack size.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFile } = require('child_process') as typeof import('child_process');
      const estimatedBytes = await new Promise<number>((resolve, reject) => {
        execFile(
          'git',
          ['count-objects', '-v'],
          { cwd: wikiFolderLocation, timeout: 10_000 },
          (error: Error | null, stdout: string) => {
            if (error) {
              reject(error);
              return;
            }
            // Parse "size-pack: <KB>" from output.
            const match = /size-pack:\s*(\d+)/.exec(stdout);
            const kilobytes = match ? Number.parseInt(match[1], 10) : 0;
            resolve(kilobytes * 1024);
          },
        );
      });

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ estimatedBytes }));
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
      }
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
