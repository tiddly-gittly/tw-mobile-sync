import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

interface IGitCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface IGitServerWithBundleReceive {
  deleteTempGitFile(workspaceId: string, fileName: string): Promise<void>;
  runGitCommand(workspaceId: string, arguments_: string[]): Promise<IGitCommandResult>;
  writeTempGitFile(workspaceId: string, fileName: string, data: Uint8Array): Promise<void>;
}

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
 * then HTTP POSTs it here. Desktop uses `git fetch <bundle> <branch>:mobile-incoming`
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

      // Detect base64-encoded bundle (sent from React Native where raw binary fetch is unreliable)
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

      // Use generic git primitives exposed by TidGi Desktop so all logic lives in the plugin.
      // These methods are added in TidGi Desktop >=0.10.x but may not be in tidgi-shared types yet.
      const gitServer = tidgiService.gitServer as unknown as IGitServerWithBundleReceive;

      // 1. Write bundle to .git/incoming.bundle
      await gitServer.writeTempGitFile(workspaceId, 'incoming.bundle', new Uint8Array(bundleBuffer));
      try {
        // 2. Verify bundle is valid
        const verifyResult = await gitServer.runGitCommand(workspaceId, ['bundle', 'verify', '.git/incoming.bundle']);
        if (verifyResult.exitCode !== 0) {
          throw new Error(`Bundle verify failed: ${verifyResult.stderr}`);
        }
        console.log('Bundle verified', { workspaceId, stdout: verifyResult.stdout.trim() });

        // 3. Detect the branch name from the bundle (mobile may use 'main' or 'master').
        // `git bundle list-heads` outputs: "<hash> refs/heads/<branch>\n..."
        let sourceBranch = 'master'; // fallback
        const listHeadsResult = await gitServer.runGitCommand(workspaceId, ['bundle', 'list-heads', '.git/incoming.bundle']);
        if (listHeadsResult.exitCode === 0 && typeof listHeadsResult.stdout === 'string') {
          const match = /refs\/heads\/(\S+)/.exec(listHeadsResult.stdout);
          if (match?.[1]) sourceBranch = match[1];
        }
        console.log('Bundle source branch detected:', { workspaceId, sourceBranch });

        // Fetch from bundle: mobile's branch → local mobile-incoming branch
        const fetchResult = await gitServer.runGitCommand(workspaceId, ['fetch', '.git/incoming.bundle', `${sourceBranch}:mobile-incoming`]);
        if (fetchResult.exitCode !== 0) {
          throw new Error(`Bundle fetch failed: ${fetchResult.stderr}`);
        }
        console.log('Bundle fetch complete', { workspaceId });
      } finally {
        // 4. Clean up temp file
        await gitServer.deleteTempGitFile(workspaceId, 'incoming.bundle').catch(() => {});
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
