/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { spawn } from 'child_process';
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { getGitPath, getRepoPath, parseBasicAuth, sendAuthChallenge, validateToken } from './utils';

exports.method = 'GET';

/**
 * Git Smart HTTP info/refs endpoint
 * Format: /tw-mobile-sync/git/{workspaceId}/info/refs?service=git-upload-pack
 *
 * This endpoint is called first by git clients to discover available refs
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/info\/refs$/;

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

    // Parse query string for service parameter
    const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);
    const service = url.searchParams.get('service');

    if (service === undefined || service === '' || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Invalid or missing service parameter');
      return;
    }

    // git-receive-pack (push) requires authentication
    if (service === 'git-receive-pack') {
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

    // Spawn git process
    const gitProcess = spawn(gitPath, [service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', repoPath], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: repoPath,
        GIT_HTTP_EXPORT_ALL: '1',
      },
    });

    // Set response headers for git smart HTTP
    const contentType = service === null ? 'text/plain' : `application/x-${service}-advertisement`;
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });

    // Write packet line header
    const serviceAnnouncement = service === null ? '' : `# service=${service}\\n`;
    const length = serviceAnnouncement.length + 4;
    const prefix = length.toString(16).padStart(4, '0');
    response.write(`${prefix}${serviceAnnouncement}0000`);

    // Pipe git output to response
    gitProcess.stdout.pipe(response);

    gitProcess.stderr.on('data', (data) => {
      console.error(`Git stderr: ${String(data)}`);
    });

    gitProcess.on('error', (error) => {
      console.error('Git process error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end('Git process error');
    });

    gitProcess.on('close', (code) => {
      if (code !== 0 && code !== undefined && code !== null) {
        console.error(`Git process exited with code ${String(code)}`);
      }
      if (!response.writableEnded) {
        response.end();
      }
    });
  } catch (error) {
    console.error('Error in git-info-refs handler:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    response.end(`Internal server error: ${(error as Error).message}`);
  }
};

exports.handler = handler;
