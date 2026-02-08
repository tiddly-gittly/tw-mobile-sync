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
