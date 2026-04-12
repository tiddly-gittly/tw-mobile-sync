import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { authorizeWorkspaceToken } from './utilities';

const MOBILE_BRANCH = 'mobile-incoming';

const DESKTOP_GIT_ENV_ARGS = [
  '-c', 'user.name=TidGi Desktop',
  '-c', 'user.email=desktop@tidgi.fun',
];

/**
 * Access TidGi service proxies via $tw.tidgi.service (see git-info-references-endpoint.ts for details).
 */
const tidgiService = ($tw as typeof $tw & { tidgi?: { service?: ITidGiGlobalService } }).tidgi?.service;

/**
 * Per-workspace merge mutex: reject concurrent merge requests for the same workspace.
 * Two phones syncing at the same time, or rapid clicks, will get 409 Conflict.
 */
const activeMerges = new Set<string>();

// ── Conflict resolution utilities (ported from TidGi Desktop mergeUtilities.ts) ──

/**
 * .tid conflict resolution:
 * - Header section (before the first blank line): mobile ("theirs") wins entirely.
 * - Body section (after the first blank line): merge both sides, keeping desktop lines plus unique mobile lines.
 */
function resolveTidConflictMarkers(content: string): string {
  const lines = content.split('\n');
  const resolved: string[] = [];
  let passedBlankLine = false;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];

    if (!line.startsWith('<<<<<<<')) {
      if (!passedBlankLine && line === '') {
        passedBlankLine = true;
      }
      resolved.push(line);
      lineIndex++;
      continue;
    }

    const conflictIsInBody = passedBlankLine;
    const oursLines: string[] = [];
    const theirsLines: string[] = [];
    let conflictSection: 'done' | 'ours' | 'theirs' = 'ours';

    lineIndex++;
    while (lineIndex < lines.length && conflictSection !== 'done') {
      const conflictLine = lines[lineIndex];
      if (conflictLine.startsWith('=======') && conflictSection === 'ours') {
        conflictSection = 'theirs';
      } else if (conflictLine.startsWith('>>>>>>>') && conflictSection === 'theirs') {
        conflictSection = 'done';
      } else if (conflictSection === 'ours') {
        oursLines.push(conflictLine);
      } else {
        theirsLines.push(conflictLine);
      }
      lineIndex++;
    }

    if (conflictIsInBody) {
      resolved.push(...oursLines);
      for (const theirsLine of theirsLines) {
        if (!oursLines.includes(theirsLine)) {
          resolved.push(theirsLine);
        }
      }
    } else {
      // "theirs" = mobile-incoming branch — mobile metadata wins
      resolved.push(...theirsLines);
      if (!passedBlankLine && theirsLines.includes('')) {
        passedBlankLine = true;
      }
    }
  }

  return resolved.join('\n');
}

/**
 * Non-.tid fallback: prefer mobile ("theirs") for all conflict sections.
 */
function resolveConflictPreferMobile(content: string): string {
  const lines = content.split('\n');
  const resolved: string[] = [];
  let section: 'normal' | 'ours' | 'theirs' = 'normal';
  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      section = 'ours';
    } else if (line.startsWith('=======') && section === 'ours') {
      section = 'theirs';
    } else if (line.startsWith('>>>>>>>') && section === 'theirs') {
      section = 'normal';
    } else if (section !== 'ours') {
      resolved.push(line);
    }
  }
  return resolved.join('\n');
}

/**
 * Resolve all conflicted files and commit using generic gitServer methods.
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
async function resolveAllConflicts(gitServer: any, workspaceId: string): Promise<void> {
  const unmergedResult = await gitServer.runGitCommand(workspaceId, ['diff', '--name-only', '--diff-filter=U']);
  const conflictedFiles = (unmergedResult.stdout as string).trim().split('\n').filter(Boolean);

  for (const file of conflictedFiles) {
    const content = await gitServer.readWorkspaceFile(workspaceId, file) as string | undefined;
    if (!content || !content.includes('<<<<<<<')) {
      await gitServer.runGitCommand(workspaceId, ['add', file]);
      continue;
    }

    const resolved = file.endsWith('.tid')
      ? resolveTidConflictMarkers(content)
      : resolveConflictPreferMobile(content);

    await gitServer.writeWorkspaceFile(workspaceId, file, resolved);
    await gitServer.runGitCommand(workspaceId, ['add', file]);
  }

  await gitServer.runGitCommand(workspaceId, [...DESKTOP_GIT_ENV_ARGS, 'commit', '--no-edit']);
}

/**
 * Merge mobile-incoming branch into main and clean up.
 * No-op if the branch does not exist.
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
async function mergeMobileIncomingIfExists(gitServer: any, workspaceId: string): Promise<void> {
  const branchCheck = await gitServer.runGitCommand(workspaceId, ['rev-parse', '--verify', `refs/heads/${MOBILE_BRANCH}`]);
  if (branchCheck.exitCode !== 0 || !(branchCheck.stdout as string).trim()) return;

  console.log('Merging mobile-incoming branch into main', { workspaceId });

  const mergeResult = await gitServer.runGitCommand(workspaceId, [
    ...DESKTOP_GIT_ENV_ARGS,
    'merge', MOBILE_BRANCH, '--no-ff', '-m', 'Merge mobile-incoming (auto-merge by TidGi Desktop)',
  ]);

  if (mergeResult.exitCode !== 0) {
    console.log('Merge conflicts detected, auto-resolving', { workspaceId, stderr: mergeResult.stderr });
    await resolveAllConflicts(gitServer, workspaceId);
  }

  // Delete mobile-incoming branch
  await gitServer.runGitCommand(workspaceId, ['branch', '-D', MOBILE_BRANCH]);

  console.log('Mobile-incoming merge complete', { workspaceId });
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.method = 'POST';

/**
 * Merge mobile-incoming branch into main after a push.
 * Mobile calls this AFTER pushing to mobile-incoming via receive-bundle.
 * All merge + .tid-aware conflict resolution logic runs inside this plugin
 * using generic gitServer methods (runGitCommand, readWorkspaceFile, writeWorkspaceFile).
 * Format: /tw-mobile-sync/git/{workspaceId}/merge-incoming
 */
exports.path = /^\/tw-mobile-sync\/git\/([^/]+)\/merge-incoming$/;
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

      // Authenticate (same as receive-pack — write operation)
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

      if (activeMerges.has(workspaceId)) {
        response.writeHead(409, { 'Content-Type': 'text/plain' });
        response.end('Merge already in progress for this workspace');
        return;
      }

      activeMerges.add(workspaceId);
      try {
        // Cast to any because tidgi-shared types may not include the new generic methods yet
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gitServer = tidgiService.gitServer as any;
        await mergeMobileIncomingIfExists(gitServer, workspaceId);
      } finally {
        activeMerges.delete(workspaceId);
      }

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    } catch (error) {
      console.error('Error in merge-incoming handler:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      response.end(`Merge failed: ${(error as Error).message}`);
    }
  })();
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.handler = handler;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
