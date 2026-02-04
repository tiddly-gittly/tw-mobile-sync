/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { spawn } from 'child_process';
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { getGitPath, getRepoPath, parseBasicAuth, sendAuthChallenge, validateToken } from './utils';

exports.method = 'POST';

/**
 * Git Smart HTTP receive-pack endpoint (for git push)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-receive-pack
 *
 * This endpoint handles the actual data transfer for push operations
 * git-receive-pack requires authentication as it modifies the repository
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-receive-pack$/;

const handler: ServerEndpointHandler = async function handler(
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  context,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Extract workspace ID from path
    const workspaceId = (context.params)?.[0];
    if (workspaceId === undefined || workspaceId === '') {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Missing workspace ID');
      return;
    }

    // git-receive-pack (push) REQUIRES authentication
    const authHeader = request.headers.authorization;
    const credentials = parseBasicAuth(authHeader);

    if (credentials === undefined) {
      sendAuthChallenge(response);
      return;
    }

    // Token can be in either username or password field
    const token = credentials.password === '' ? credentials.username : credentials.password;
    const isValid = await validateToken(workspaceId, token);

    if (!isValid) {
      sendAuthChallenge(response);
      return;
    }

    // Get repository path
    const repoPath = await getRepoPath(workspaceId);
    if (repoPath === undefined) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Workspace not found');
      return;
    }

    // Get git executable path
    const gitPath = await getGitPath();

    // Spawn git-receive-pack process
    const gitProcess = spawn(gitPath, ['receive-pack', '--stateless-rpc', repoPath], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: repoPath,
        GIT_HTTP_EXPORT_ALL: '1',
      },
    });

    // Set response headers
    response.writeHead(200, {
      'Content-Type': 'application/x-git-receive-pack-result',
      'Cache-Control': 'no-cache',
    });

    // Pipe request body to git stdin
    request.pipe(gitProcess.stdin);

    // Pipe git stdout to response
    gitProcess.stdout.pipe(response);

    gitProcess.stderr.on('data', (data) => {
      console.error(`Git receive-pack stderr: ${String(data)}`);
    });

    gitProcess.on('error', (error) => {
      console.error('Git receive-pack process error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end('Git process error');
    });

    gitProcess.on('close', (code) => {
      if (code !== 0 && code !== undefined && code !== null) {
        console.error(`Git receive-pack process exited with code ${String(code)}`);
      }
      if (!response.writableEnded) {
        response.end();
      }
    });

    // Handle client disconnect
    request.on('close', () => {
      if (!gitProcess.killed) {
        gitProcess.kill();
      }
    });
  } catch (error) {
    console.error('Error in git-receive-pack handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
