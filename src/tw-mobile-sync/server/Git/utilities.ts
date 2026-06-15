import type Http from 'http';
import type { ITidGiGlobalService } from 'tidgi-shared';

/**
 * Utilities for Git Smart HTTP protocol implementation
 */

/**
 * Parse Basic Authentication header
 * Format: "Basic base64(username:password)" or "Basic base64(:token)"
 */
export function parseBasicAuth(authHeader: string | undefined): { password: string; username: string } | undefined {
  if (authHeader === undefined || authHeader === '' || !authHeader.startsWith('Basic ')) {
    return undefined;
  }

  try {
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':', 2);

    return {
      username: username || '',
      password: password || '',
    };
  } catch {
    return undefined;
  }
}

/**
 * Send 401 Unauthorized response with Basic Auth challenge
 */
export function sendAuthChallenge(response: import('http').ServerResponse): void {
  response.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="TidGi Git Smart HTTP"',
    'Content-Type': 'text/plain',
  });
  response.end('Authentication required');
}

const TOKEN_CONFIG_TITLE = '$:/plugins/linonetwo/tw-mobile-sync/Config/WorkspaceToken';

/**
 * In standalone mode the workspace token is read from a config tiddler so
 * tests can protect the mock server without starting TidGi Desktop.
 */
function getStandaloneWorkspaceToken(): string | undefined {
  const token = ($tw).wiki.getTiddlerText(TOKEN_CONFIG_TITLE)?.trim();
  return token === '' ? undefined : token;
}

/**
 * Validate the request's Basic Auth token.
 * In TidGi Desktop the workspace service stores and validates the token.
 * In standalone mode the token is read from a config tiddler.
 */
export async function authorizeWorkspaceToken(
  request: Http.ClientRequest & Http.InformationEvent,
  response: Http.ServerResponse,
  workspaceService: ITidGiGlobalService['workspace'] | undefined,
  workspaceId: string,
): Promise<boolean> {
  const workspaceToken = workspaceService !== undefined
    ? await workspaceService.getWorkspaceToken(workspaceId)
    : getStandaloneWorkspaceToken();

  if (workspaceToken === undefined || workspaceToken === '') {
    return true;
  }

  const credentials = parseBasicAuth(request.headers.authorization);
  if (credentials === undefined) {
    sendAuthChallenge(response);
    return false;
  }

  const token = credentials.password === '' ? credentials.username : credentials.password;
  const valid = workspaceService !== undefined
    ? await workspaceService.validateWorkspaceToken(workspaceId, token)
    : token === workspaceToken;

  if (!valid) {
    sendAuthChallenge(response);
    return false;
  }

  return true;
}
