import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Create a git bundle on the desktop and send it to mobile for fetching.
 *
 * Private protocol between TidGi Mobile ↔ TidGi Desktop.
 * Replaces JGit's git-upload-pack HTTP transport which has a multi-request bug.
 * Standard git services (GitHub, etc.) do NOT implement this endpoint.
 *
 * Request body (JSON string):  { "have": "<commitOid>" }
 *   - "have" is mobile's current HEAD. Desktop creates an incremental bundle.
 *   - If "have" is empty/missing, a full bundle of HEAD is created.
 *
 * Response: base64-encoded bundle (Accept: ...base64) or raw binary.
 * Header X-Git-Bundle-Head contains the desktop HEAD oid.
 * 204 No Content if mobile is already up-to-date.
 *
 * Format: /tw-mobile-sync/git/{workspaceId}/create-bundle
 */
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

      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Workspace service not available');
        return;
      }
      if (!(await authorizeWorkspaceToken(request, response, tidgiService.workspace, workspaceId))) return;
      if (!tidgiService.gitServer) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Git server service not available');
        return;
      }

      // Parse mobile's current HEAD ("have")
      let haveOid = '';
      try {
        const body = typeof context.data === 'string' ? context.data : '';
        if (body.trim()) {
          haveOid = (JSON.parse(body) as { have?: string }).have ?? '';
        }
      } catch { /* treat as empty */ }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gitServer = tidgiService.gitServer as any;

      // Auto-commit pending desktop changes
      const statusResult = await gitServer.runGitCommand(workspaceId, ['status', '--porcelain']);
      if ((statusResult.stdout as string).trim().length > 0) {
        await gitServer.runGitCommand(workspaceId, ['add', '-A']);
        await gitServer.runGitCommand(workspaceId, [
          '-c', 'user.name=TidGi Desktop', '-c', 'user.email=desktop@tidgi.fun',
          'commit', '-m', `Auto commit before mobile sync ${new Date().toISOString()}`,
        ]);
      }

      // Get desktop HEAD
      const headResult = await gitServer.runGitCommand(workspaceId, ['rev-parse', 'HEAD']);
      const desktopHead = (headResult.stdout as string).trim();
      if (!desktopHead) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Could not determine HEAD');
        return;
      }

      // Already up-to-date?
      if (haveOid === desktopHead) {
        response.writeHead(204);
        response.end();
        return;
      }

      // Build bundle. Incremental if mobile's commit exists in our history.
      const bundleDest = `.git/${BUNDLE_FILE}`;
      let created = false;

      if (haveOid) {
        const verifyResult = await gitServer.runGitCommand(workspaceId, ['cat-file', '-t', haveOid]);
        if ((verifyResult.stdout as string).trim() === 'commit') {
          const incResult = await gitServer.runGitCommand(workspaceId, [
            'bundle', 'create', bundleDest, `${haveOid}..HEAD`, '--all',
          ]);
          created = incResult.exitCode === 0;
        }
      }

      if (!created) {
        // Full bundle (first sync or diverged history)
        const fullResult = await gitServer.runGitCommand(workspaceId, [
          'bundle', 'create', bundleDest, 'HEAD',
        ]);
        if (fullResult.exitCode !== 0) {
          throw new Error(`Bundle create failed: ${fullResult.stderr}`);
        }
      }

      // Read bundle file using Node.js fs (available in TiddlyWiki server context)
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const path = require('path') as typeof import('path');

      const repoPath = await gitServer.getWorkspaceRepoPath(workspaceId) as string | undefined;
      if (!repoPath) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Could not determine repo path');
        return;
      }

      const bundlePath = path.join(repoPath, '.git', BUNDLE_FILE);
      let bundleData: Buffer;
      try {
        bundleData = fs.readFileSync(bundlePath);
      } finally {
        try { fs.unlinkSync(bundlePath); } catch { /* ignore */ }
      }

      console.log('create-bundle', { workspaceId, have: haveOid.slice(0, 8), head: desktopHead.slice(0, 8), bytes: bundleData.length });

      // Respond: base64 or raw binary depending on Accept header
      const accept = (request as unknown as Http.IncomingMessage).headers?.accept ?? '';
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
