/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { spawn } from 'child_process';
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { getGitPath, getRepoPath, parseBasicAuth, sendAuthChallenge, validateToken } from './utils';

exports.method = 'POST';

/**
 * Git Smart HTTP upload-pack endpoint (for git fetch/pull)
 * Format: /tw-mobile-sync/git/{workspaceId}/git-upload-pack
 *
 * This endpoint handles the actual data transfer for fetch/pull operations
 * git-upload-pack allows fetching (reading) from the repository
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/git-upload-pack$/;

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

    // git-upload-pack (fetch/pull) may not require auth for public repos
    // but we can still validate if provided
    const authHeader = request.headers.authorization;
    if (authHeader !== undefined && authHeader !== '') {
      const credentials = parseBasicAuth(authHeader);
      if (credentials !== undefined) {
        const token = credentials.password === '' ? credentials.username : credentials.password;
        const isValid = await validateToken(workspaceId, token);
        if (!isValid) {
          sendAuthChallenge(response);
          return;
        }
      }
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

    // Spawn git-upload-pack process
    const gitProcess = spawn(gitPath, ['upload-pack', '--stateless-rpc', repoPath], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: repoPath,
        GIT_HTTP_EXPORT_ALL: '1',
      },
    });

    // Set response headers
    response.writeHead(200, {
      'Content-Type': 'application/x-git-upload-pack-result',
      'Cache-Control': 'no-cache',
    });

    // Pipe request body to git stdin
    request.pipe(gitProcess.stdin);

    // Pipe git stdout to response
    gitProcess.stdout.pipe(response);

    gitProcess.stderr.on('data', (data) => {
      console.error(`Git upload-pack stderr: ${String(data)}`);
    });

    gitProcess.on('error', (error) => {
      console.error('Git upload-pack process error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end('Git process error');
    });

    gitProcess.on('close', (code) => {
      if (code !== 0 && code !== undefined && code !== null) {
        console.error(`Git upload-pack process exited with code ${String(code)}`);
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
    console.error('Error in git-upload-pack handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
