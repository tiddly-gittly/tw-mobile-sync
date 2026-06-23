import fs from 'fs';
import type Http from 'http';
import path from 'path';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { updateClientFromRequest } from '../../data/updateClientFromRequest';
import { createGitRunner } from '../../git/gitRunnerFactory';
import { getWorkspaceRepoPath } from '../../git/workspaceResolver';
import { authorizeWorkspaceToken, getTidGiService } from './utilities';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/create-bundle$/;
exports.bodyFormat = 'string';
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const BUNDLE_FILE = 'outgoing.bundle';

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
      if (!(await authorizeWorkspaceToken(request, response, tidgiService?.workspace, workspaceId))) return;

      const repoPath = await getWorkspaceRepoPath(workspaceId, tidgiService?.workspace);
      if (!repoPath) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Workspace not found');
        return;
      }

      let haveOid = '';
      try {
        const body = typeof context.data === 'string' ? context.data : '';
        if (body.trim()) {
          haveOid = (JSON.parse(body) as { have?: string }).have ?? '';
        }
      } catch { /* treat as empty */ }

      const runner = createGitRunner(tidgiService, workspaceId);

      const statusResult = await runner.run(['status', '--porcelain'], repoPath);
      if (statusResult.stdout.trim().length > 0) {
        await runner.run(['add', '-A'], repoPath);
        await runner.run(
          ['-c', 'user.name=TidGi Desktop', '-c', 'user.email=desktop@tidgi.fun', 'commit', '-m', `Auto commit before mobile sync ${new Date().toISOString()}`],
          repoPath,
        );
      }

      const headResult = await runner.run(['rev-parse', 'HEAD'], repoPath);
      const desktopHead = headResult.stdout.trim();
      if (!desktopHead) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Could not determine HEAD');
        return;
      }

      if (haveOid === desktopHead) {
        updateClientFromRequest(request, { recentlySyncedString: '↓ Already up to date' });
        response.writeHead(204);
        response.end();
        return;
      }

      const bundleDestination = `.git/${BUNDLE_FILE}`;
      let created = false;

      if (haveOid) {
        const verifyResult = await runner.run(['cat-file', '-t', haveOid], repoPath);
        if (verifyResult.stdout.trim() === 'commit') {
          const incResult = await runner.run(
            ['bundle', 'create', bundleDestination, `${haveOid}..HEAD`, '--all'],
            repoPath,
          );
          created = incResult.exitCode === 0;
        }
      }

      if (!created) {
        const fullResult = await runner.run(['bundle', 'create', bundleDestination, 'HEAD'], repoPath);
        if (fullResult.exitCode !== 0) {
          throw new Error(`Bundle create failed: ${fullResult.stderr}`);
        }
      }

      const bundlePath = path.join(repoPath, '.git', BUNDLE_FILE);
      let bundleData: Buffer;
      try {
        bundleData = fs.readFileSync(bundlePath);
      } finally {
        try {
          fs.unlinkSync(bundlePath);
        } catch { /* ignore */ }
      }

      console.log('create-bundle', { workspaceId, have: haveOid.slice(0, 8), head: desktopHead.slice(0, 8), bytes: bundleData.length });

      updateClientFromRequest(request, { recentlySyncedString: '↓ Bundle sent to mobile' });

      const accept = (request as unknown as Http.IncomingMessage).headers.accept ?? '';
      if (accept.includes('base64')) {
        const base64 = bundleData.toString('base64');
        response.writeHead(200, {
          'Content-Type': 'application/x-git-bundle-base64',
          'X-Git-Bundle-Head': desktopHead,
          'Content-Length': String(Buffer.byteLength(base64)),
        });
        response.end(base64);
      } else {
        response.writeHead(200, {
          'Content-Type': 'application/x-git-bundle',
          'X-Git-Bundle-Head': desktopHead,
          'Content-Length': String(bundleData.length),
        });
        response.end(bundleData);
      }
    } catch (error) {
      console.error('Error in create-bundle handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Bundle create failed: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
