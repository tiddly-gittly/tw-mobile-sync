import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { mergeTiddler } from '../../data/mergeTiddler';
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

async function ensureCommittedBeforeMerge(gitServer: any, workspaceId: string): Promise<void> {
  const statusResult = await gitServer.runGitCommand(workspaceId, ['status', '--porcelain']);
  const statusOutput = (statusResult.stdout as string).trim();
  if (statusOutput.length === 0) return;

  const addResult = await gitServer.runGitCommand(workspaceId, ['add', '-A']);
  if (addResult.exitCode !== 0) {
    throw new Error(`git add failed before merge: ${addResult.stderr}`);
  }

  const commitResult = await gitServer.runGitCommand(workspaceId, [
    ...DESKTOP_GIT_ENV_ARGS,
    'commit', '-m', `Auto commit before mobile merge ${new Date().toISOString()}`,
  ]);
  if (commitResult.exitCode !== 0) {
    throw new Error(`git commit failed before merge: ${commitResult.stderr}`);
  }

  console.log('Committed pending desktop changes before merging mobile-incoming', { workspaceId });
}

async function getUnmergedFiles(gitServer: any, workspaceId: string): Promise<string[]> {
  const unmergedResult = await gitServer.runGitCommand(workspaceId, ['diff', '--name-only', '--diff-filter=U']);
  return (unmergedResult.stdout as string).trim().split('\n').filter(Boolean);
}

function parseTidFile(content: string): Record<string, unknown> {
  const separatorMatch = /\r?\n\r?\n/.exec(content);
  const header = separatorMatch ? content.slice(0, separatorMatch.index) : content;
  const body = separatorMatch ? content.slice(separatorMatch.index + separatorMatch[0].length) : '';
  const fields = $tw.utils.parseFields(header, Object.create(null)) as Record<string, unknown>;
  fields.text = body;
  return fields;
}

function stringifyFieldValue(name: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  const fieldModule = $tw.Tiddler.fieldModules[name] as { stringify?: (value: unknown) => string } | undefined;
  if (fieldModule?.stringify) {
    return fieldModule.stringify.call(null, value);
  }
  if (Array.isArray(value)) {
    return $tw.utils.stringifyList(value);
  }
  return String(value);
}

function serializeTidFields(fields: Record<string, unknown>): string {
  const fieldNames = Object.keys(fields).filter(name => name !== 'text').sort();
  const header = fieldNames.map(name => `${name}: ${stringifyFieldValue(name, fields[name])}`).join('\n');
  const text = typeof fields.text === 'string' ? fields.text : stringifyFieldValue('text', fields.text);
  return `${header}\n\n${text}`;
}

async function readGitFileAtRef(gitServer: any, workspaceId: string, ref: string, file: string): Promise<string | undefined> {
  const result = await gitServer.runGitCommand(workspaceId, ['show', `${ref}:${file}`]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout as string;
}

async function getBaseTidFields(gitServer: any, workspaceId: string, file: string): Promise<Record<string, unknown> | undefined> {
  const baseResult = await gitServer.runGitCommand(workspaceId, ['merge-base', 'HEAD', MOBILE_BRANCH]);
  const baseRef = (baseResult.stdout as string).trim();
  if (baseResult.exitCode !== 0 || !baseRef) return undefined;
  const baseContent = await readGitFileAtRef(gitServer, workspaceId, baseRef, file);
  return baseContent ? parseTidFile(baseContent) : undefined;
}

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

async function resolveTidConflict(gitServer: any, workspaceId: string, file: string, content: string): Promise<string> {
  const markerResolved = resolveTidConflictMarkers(content);
  const oursContent = await readGitFileAtRef(gitServer, workspaceId, 'HEAD', file);
  const theirsContent = await readGitFileAtRef(gitServer, workspaceId, MOBILE_BRANCH, file);
  if (!oursContent || !theirsContent) {
    return markerResolved;
  }

  try {
    const oursFields = parseTidFile(oursContent);
    const theirsFields = parseTidFile(theirsContent);
    const baseFields = await getBaseTidFields(gitServer, workspaceId, file);
    const merged = mergeTiddler(
      theirsFields as unknown as import('tiddlywiki').ITiddlerFields,
      oursFields as unknown as import('tiddlywiki').ITiddlerFields,
      baseFields as unknown as import('tiddlywiki').ITiddlerFields | undefined,
    );
    return serializeTidFields(merged as unknown as Record<string, unknown>);
  } catch (error) {
    console.warn('3-way .tid merge failed, falling back to marker resolver', { workspaceId, file, message: (error as Error).message });
    return markerResolved;
  }
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
  const conflictedFiles = await getUnmergedFiles(gitServer, workspaceId);

  for (const file of conflictedFiles) {
    const content = await gitServer.readWorkspaceFile(workspaceId, file) as string | undefined;
    if (!content || !content.includes('<<<<<<<')) {
      const addResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage conflicted file ${file}: ${addResult.stderr}`);
      }
      continue;
    }

    const resolved = file.endsWith('.tid')
      ? await resolveTidConflict(gitServer, workspaceId, file, content)
      : resolveConflictPreferMobile(content);

    await gitServer.writeWorkspaceFile(workspaceId, file, resolved);
    const addResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage resolved conflict for ${file}: ${addResult.stderr}`);
    }
  }

  const commitResult = await gitServer.runGitCommand(workspaceId, [...DESKTOP_GIT_ENV_ARGS, 'commit', '--no-edit']);
  if (commitResult.exitCode !== 0) {
    throw new Error(`Failed to commit resolved conflicts: ${commitResult.stderr}`);
  }
}

/**
 * Merge mobile-incoming branch into main and clean up.
 * No-op if the branch does not exist.
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
async function mergeMobileIncomingIfExists(gitServer: any, workspaceId: string): Promise<void> {
  const branchCheck = await gitServer.runGitCommand(workspaceId, ['rev-parse', '--verify', `refs/heads/${MOBILE_BRANCH}`]);
  if (branchCheck.exitCode !== 0 || !(branchCheck.stdout as string).trim()) return;

  await ensureCommittedBeforeMerge(gitServer, workspaceId);

  console.log('Merging mobile-incoming branch into main', { workspaceId });

  const mergeResult = await gitServer.runGitCommand(workspaceId, [
    ...DESKTOP_GIT_ENV_ARGS,
    'merge', MOBILE_BRANCH, '--no-ff', '-m', 'Merge mobile-incoming (auto-merge by TidGi Desktop)',
  ]);

  if (mergeResult.exitCode !== 0) {
    console.log('Merge conflicts detected, auto-resolving', { workspaceId, stderr: mergeResult.stderr });
    const conflictedFiles = await getUnmergedFiles(gitServer, workspaceId);
    if (conflictedFiles.length === 0) {
      throw new Error(`Merge failed before conflict markers were created: ${mergeResult.stderr || mergeResult.stdout}`);
    }
    await resolveAllConflicts(gitServer, workspaceId);
  }

  // Delete mobile-incoming branch only after merge resolution committed successfully.
  const deleteBranchResult = await gitServer.runGitCommand(workspaceId, ['branch', '-D', MOBILE_BRANCH]);
  if (deleteBranchResult.exitCode !== 0) {
    throw new Error(`Failed to delete ${MOBILE_BRANCH}: ${deleteBranchResult.stderr}`);
  }

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
