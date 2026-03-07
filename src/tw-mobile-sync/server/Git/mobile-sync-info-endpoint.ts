import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';

const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'GET';
exports.path = /^\/tw-mobile-sync\/git\/mobile-sync-info$/;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

function isWikiWorkspace(workspace: unknown): workspace is { id: string; isSubWiki?: boolean; mainWikiID?: string | null; name?: string } {
  if (!workspace || typeof workspace !== 'object') return false;
  const candidate = workspace as Record<string, unknown>;
  return typeof candidate.id === 'string';
}

function getProtocol(request: Http.ClientRequest & Http.InformationEvent): string {
  const requestHeaders = request.headers as Record<string, string | string[] | undefined>;
  const forwardedProto = requestHeaders['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0].trim();
  }
  const requestWithSocket = request as Http.ClientRequest & Http.InformationEvent & { socket: { encrypted?: boolean } };
  return requestWithSocket.socket.encrypted ? 'https' : 'http';
}

function getHost(request: Http.ClientRequest & Http.InformationEvent): string {
  const requestHeaders = request.headers as Record<string, string | string[] | undefined>;
  const forwardedHost = requestHeaders['x-forwarded-host'];
  if (typeof forwardedHost === 'string' && forwardedHost.length > 0) {
    return forwardedHost.split(',')[0].trim();
  }
  return request.headers.host || 'localhost';
}

const handler: ServerEndpointHandler = function handler(
  request: Http.ClientRequest & Http.InformationEvent,
  response: Http.ServerResponse,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  void (async () => {
    try {
      if (!tidgiService?.workspace) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Workspace service not available' }));
        return;
      }

      const allWorkspaces = await tidgiService.workspace.getWorkspacesAsList();
      const wikiWorkspaces = allWorkspaces.filter(workspace => isWikiWorkspace(workspace));
      if (wikiWorkspaces.length === 0) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'No workspace found' }));
        return;
      }
      const mainWorkspaces = wikiWorkspaces.filter(workspace => !workspace.isSubWiki);
      const fallbackWorkspace = mainWorkspaces[0] ?? wikiWorkspaces[0];

      const workspaceToken = await tidgiService.workspace.getWorkspaceToken(fallbackWorkspace.id);

      // If a token is configured, this endpoint must not expose it.
      // The client should scan the QR code instead.
      if (typeof workspaceToken === 'string' && workspaceToken.length > 0) {
        response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'token_protected' }));
        return;
      }

      const host = getHost(request);
      const protocol = getProtocol(request);
      const baseUrl = `${protocol}://${host}`;

      const subWorkspaces = await tidgiService.workspace.getSubWorkspacesAsList(fallbackWorkspace.id);

      const payload = {
        baseUrl,
        workspaceId: fallbackWorkspace.id,
        workspaceName: fallbackWorkspace.name,
        subWorkspaces: subWorkspaces.map(subWorkspace => ({
          id: subWorkspace.id,
          name: subWorkspace.name,
          mainWikiID: fallbackWorkspace.id,
        })),
      };

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
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
