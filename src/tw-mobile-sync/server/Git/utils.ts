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
      username: username ?? '',
      password: password ?? '',
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

/**
 * Validate workspace token using global.service
 * Returns true if token is valid, false otherwise
 */
export async function validateToken(workspaceId: string, token: string): Promise<boolean> {
  // Check if service is available
  if (typeof global === 'undefined' || global.service?.workspace?.validateWorkspaceToken === undefined) {
    console.warn('global.service.workspace.validateWorkspaceToken is not available');
    // TODO: For now, return true to allow development without Desktop implementation
    // This should return false in production
    return true;
  }

  try {
    return await global.service.workspace.validateWorkspaceToken(workspaceId, token);
  } catch (error) {
    console.error(`Failed to validate token for workspace ${workspaceId}:`, error);
    return false;
  }
}

/**
 * Get repository path for a workspace
 */
export async function getRepoPath(workspaceId: string): Promise<string | undefined> {
  if (typeof global === 'undefined' || global.service?.git?.getWorkspaceRepoPath === undefined) {
    console.warn('global.service.git.getWorkspaceRepoPath is not available');
    // TODO: Return undefined for now, Desktop needs to implement this
    return undefined;
  }

  try {
    return await global.service.git.getWorkspaceRepoPath(workspaceId);
  } catch (error) {
    console.error(`Failed to get repo path for workspace ${workspaceId}:`, error);
    return undefined;
  }
}

/**
 * Get git executable path
 */
export async function getGitPath(): Promise<string> {
  if (typeof global === 'undefined' || global.service?.git?.getGitExecutablePath === undefined) {
    console.warn('global.service.git.getGitExecutablePath is not available');
    // Fallback to system git
    return 'git';
  }

  try {
    return await global.service.git.getGitExecutablePath();
  } catch (error) {
    console.error('Failed to get git executable path:', error);
    return 'git';
  }
}
