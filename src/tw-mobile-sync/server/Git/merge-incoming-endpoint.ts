import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';
import { formatGitMergeSummary } from '../../data/formatGitSyncSummary';
import { updateClientFromRequest } from '../../data/updateClientFromRequest';
import { authorizeWorkspaceToken, getTidGiService } from './utilities';

/**
 * Local interface for git server methods used by merge logic.
 * These methods exist at runtime on tidgiService.gitServer but are not yet
 * published in the tidgi-shared IGitServerService type definition.
 */
interface IGitServerMethods {
  runGitCommand(workspaceId: string, gitArguments: string[], environment?: Record<string, string>): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  readWorkspaceFile(workspaceId: string, relativePath: string): Promise<string | undefined>;
  writeWorkspaceFile(workspaceId: string, relativePath: string, content: string): Promise<void>;
}

const MOBILE_BRANCH = 'mobile-incoming';

/**
 * Git identity for auto-commits, set as environment variables so they take
 * precedence over any machine-local git config.  This matches the server-side
 * DESKTOP_GIT_IDENTITY in mergeUtilities.ts and avoids the unreliable `-c`
 * config-flag approach that can be silently overridden by existing env vars.
 */
const DESKTOP_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'TidGi Desktop',
  GIT_AUTHOR_EMAIL: 'desktop@tidgi.fun',
  GIT_COMMITTER_NAME: 'TidGi Desktop',
  GIT_COMMITTER_EMAIL: 'desktop@tidgi.fun',
} as const;

/**
 * Per-workspace merge mutex: reject concurrent merge requests for the same workspace.
 * Two phones syncing at the same time, or rapid clicks, will get 409 Conflict.
 */
const activeMerges = new Set<string>();

// ── Pre-merge helpers ──

async function ensureCommittedBeforeMerge(gitServer: IGitServerMethods, workspaceId: string): Promise<void> {
  // Force index refresh with fsmonitor disabled — Git's fsmonitor/index caching
  // on Windows can report a clean working tree even when files are dirty.
  await gitServer.runGitCommand(workspaceId, ['-c', 'core.fsmonitor=false', 'update-index', '--really-refresh']);

  // Stage with fsmonitor disabled to avoid Windows race conditions
  const addResult = await gitServer.runGitCommand(workspaceId, ['-c', 'core.fsmonitor=false', 'add', '-A']);
  if (addResult.exitCode !== 0) {
    throw new Error(`git add failed before merge: ${addResult.stderr}`);
  }
  console.log('ensureCommittedBeforeMerge: git add -A succeeded', { workspaceId });

  // Check if anything was actually staged (exit code 1 = changes exist)
  const diffResult = await gitServer.runGitCommand(workspaceId, ['diff', '--cached', '--quiet']);
  if (diffResult.exitCode === 0) {
    console.log('ensureCommittedBeforeMerge: no changes to commit', { workspaceId });
    return;
  }

  const commitResult = await gitServer.runGitCommand(
    workspaceId,
    ['commit', '-m', `Auto commit before mobile merge ${new Date().toISOString()}`],
    { ...DESKTOP_GIT_IDENTITY },
  );
  if (commitResult.exitCode !== 0) {
    throw new Error(`git commit failed before merge: ${commitResult.stderr}`);
  }
  console.log('ensureCommittedBeforeMerge: commit succeeded', { workspaceId, stdout: commitResult.stdout, stderr: commitResult.stderr });

  // Verify the commit actually contains the expected changes
  const verifyResult = await gitServer.runGitCommand(workspaceId, ['show', 'HEAD', '--name-status', '--oneline']);
  console.log('ensureCommittedBeforeMerge: verifying HEAD after commit', {
    workspaceId,
    showHead: verifyResult.stdout.trim(),
  });
  if (verifyResult.exitCode !== 0) {
    console.warn('ensureCommittedBeforeMerge: verification failed', { workspaceId, stderr: verifyResult.stderr });
  }
}

async function getUnmergedFiles(gitServer: IGitServerMethods, workspaceId: string): Promise<string[]> {
  const unmergedResult = await gitServer.runGitCommand(workspaceId, ['diff', '--name-only', '--diff-filter=U']);
  return unmergedResult.stdout.trim().split('\n').filter(Boolean);
}

// ── Conflict resolution utilities ──

interface TidConflictOptions {
  /**
   * When true and a conflict block starts in the header but contains a blank-line
   * separator in EITHER ours or theirs, the block is split: header keeps theirs,
   * body merges ours lines + unique theirs lines.
   * Default false: entire block prefers theirs (add/add mobile-wins behaviour).
   */
  mergeHeaderBodyConflicts?: boolean;
}

/**
 * Split a list of lines at the first blank line into [headerLines, bodyLines].
 * The blank line itself is excluded from both parts.
 */
function splitAtBlankLine(lines: string[]): { header: string[]; body: string[] } {
  const blankIndex = lines.indexOf('');
  if (blankIndex === -1) {
    return { header: lines, body: [] };
  }
  return {
    header: lines.slice(0, blankIndex),
    body: lines.slice(blankIndex + 1),
  };
}

/**
 * .tid conflict marker resolution (FALLBACK when 3-way merge fails).
 *
 * - Header section (before the first blank line): mobile ("theirs") wins entirely.
 * - Body section (after the first blank line): merge both sides, keeping desktop lines plus unique mobile lines.
 * - When `options.mergeHeaderBodyConflicts` is true and a conflict block starts in
 *   the header but GIT produced a conflict block spanning into the body
 *   (i.e. a blank line exists in ours/theirs sections), the block is split
 *   at the blank line: header → theirs wins, body → merge ours + unique theirs.
 */
function resolveTidConflictMarkers(content: string, options: TidConflictOptions = {}): string {
  // Normalize CRLF to LF for consistent splitting across platforms (Windows uses \r\n)
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { mergeHeaderBodyConflicts = false } = options;
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
      // Body conflict: keep ours lines + unique theirs lines
      resolved.push(...oursLines);
      for (const theirsLine of theirsLines) {
        if (!oursLines.includes(theirsLine)) {
          resolved.push(theirsLine);
        }
      }
    } else if (mergeHeaderBodyConflicts) {
      // Header-starting conflict: check if it spans into the body.
      // Git may produce a single conflict block covering both header fields
      // AND body text when both sides modified overlapping lines near the blank line.
      const { header: _oursHeader, body: oursBody } = splitAtBlankLine(oursLines);
      const { header: theirsHeader, body: theirsBody } = splitAtBlankLine(theirsLines);

      if (oursBody.length > 0 || theirsBody.length > 0) {
        // Conflict spans header + body — keep theirs header, merge bodies
        resolved.push(...theirsHeader);
        resolved.push(''); // blank-line separator
        resolved.push(...oursBody);
        for (const theirsBodyLine of theirsBody) {
          if (!oursBody.includes(theirsBodyLine)) {
            resolved.push(theirsBodyLine);
          }
        }
        passedBlankLine = true;
      } else {
        // Purely header conflict — theirs wins
        resolved.push(...theirsLines);
        if (!passedBlankLine && theirsLines.includes('')) {
          passedBlankLine = true;
        }
      }
    } else {
      // Header-starting conflict without merge option: theirs wins
      resolved.push(...theirsLines);
      if (!passedBlankLine && theirsLines.includes('')) {
        passedBlankLine = true;
      }
    }
  }

  return resolved.join('\n');
}

/**
 * .tid conflict resolution via marker parsing (mobile-wins header, merged body).
 */
function resolveTidConflict(_gitServer: IGitServerMethods, _workspaceId: string, _file: string, content: string): string {
  return resolveTidConflictMarkers(content, { mergeHeaderBodyConflicts: true });
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
 * Write resolved content to disk and defend against the filesystem watcher
 * overwriting it with stale in-memory wiki state.
 *
 * The watcher (chokidar → syncer) fires asynchronously after every fs.writeFile.
 * If the in-memory wiki is stale, the syncer writes the old version back to disk,
 * clobbering the merge result.  We wait for the watcher to fire and settle, then
 * re-read the file to check.  If it was overwritten, we re-write the correct
 * content.  Up to 3 retries with increasing backoff.
 */

async function writeResolvedWithWatcherDefense(
  gitServer: IGitServerMethods,
  workspaceId: string,
  file: string,
  resolved: string,
): Promise<void> {
  const backoffs = [300, 500, 1000];

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    await gitServer.writeWorkspaceFile(workspaceId, file, resolved);

    if (attempt < backoffs.length) {
      // Let the watcher fire, potentially overwrite, and settle its debounce window.
      await new Promise<void>(resolveBackoff => {
        setTimeout(resolveBackoff, backoffs[attempt]);
      });

      const onDisk = await gitServer.readWorkspaceFile(workspaceId, file);
      if (onDisk === resolved) {
        // Watcher didn't overwrite (or in-memory matches our merge result).
        return;
      }
      console.warn('merge: watcher overwrote resolved file, retrying', {
        workspaceId,
        file,
        attempt: attempt + 1,
        backoffMs: backoffs[attempt],
      });
    }
  }
  // After exhausting retries, write one final time and proceed.
  // The commit will capture whatever is on disk next; we log the risk.
  await gitServer.writeWorkspaceFile(workspaceId, file, resolved);
  console.warn('merge: exhausted watcher-defense retries, committing best-effort', { workspaceId, file });
}

async function resolveAllConflicts(gitServer: IGitServerMethods, workspaceId: string): Promise<void> {
  const conflictedFiles = await getUnmergedFiles(gitServer, workspaceId);
  /** Track which files we resolved so we can do a final verification before commit. */
  const resolvedFiles = new Map<string, string>();

  for (const file of conflictedFiles) {
    const content = await gitServer.readWorkspaceFile(workspaceId, file);
    if (!content || !content.includes('<<<<<<<')) {
      const addResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage conflicted file ${file}: ${addResult.stderr}`);
      }
      continue;
    }

    const resolved = file.endsWith('.tid')
      ? resolveTidConflict(gitServer, workspaceId, file, content)
      : resolveConflictPreferMobile(content);

    await writeResolvedWithWatcherDefense(gitServer, workspaceId, file, resolved);
    resolvedFiles.set(file, resolved);

    const addResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage resolved conflict for ${file}: ${addResult.stderr}`);
    }

    // Verify staged content wasn't overwritten by watcher syncer
    if (file.endsWith('.tid')) {
      const staged = await gitServer.runGitCommand(workspaceId, ['show', `:${file}`]);
      const normalizedResolved = resolved.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedStaged = (staged.stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (normalizedStaged !== normalizedResolved) {
        // Watcher overwrote the file, re-write and re-stage
        console.warn('merge: watcher overwrote staged .tid file, re-defending', { workspaceId, file });
        await gitServer.writeWorkspaceFile(workspaceId, file, resolved);
        const reAddResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
        if (reAddResult.exitCode !== 0) {
          throw new Error(`Failed to re-stage resolved conflict for ${file}: ${reAddResult.stderr}`);
        }
      }
    }
  }

  // Final sweep: after all files are processed, the watcher may have overwritten
  // files that were written earlier in the loop.  Verify and re-defend if needed.
  for (const [file, resolved] of resolvedFiles) {
    const onDisk = await gitServer.readWorkspaceFile(workspaceId, file);
    if (onDisk !== resolved) {
      console.warn('merge: watcher overwrote file during batch, re-defending before commit', { workspaceId, file });
      await writeResolvedWithWatcherDefense(gitServer, workspaceId, file, resolved);
      const addResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to re-stage resolved conflict for ${file}: ${addResult.stderr}`);
      }
    }
  }

  const commitResult = await gitServer.runGitCommand(workspaceId, ['commit', '--no-edit'], { ...DESKTOP_GIT_IDENTITY });
  if (commitResult.exitCode !== 0) {
    throw new Error(`Failed to commit resolved conflicts: ${commitResult.stderr}`);
  }

  // Restore resolved .tid files from commit to working tree, overwriting any
  // watcher/syncer stale content that was written after the merge.
  const tidFiles = conflictedFiles.filter((f: string) => f.endsWith('.tid'));
  if (tidFiles.length > 0) {
    await gitServer.runGitCommand(workspaceId, ['checkout', 'HEAD', '--', ...tidFiles]);
  }

  // Post-commit verification: the watcher syncer's ensureCommittedBeforeServe
  // can run `git add -A` between our final staging and commit, overwriting
  // correctly staged content with stale watcher content from the working tree.
  // Verify .tid files in the committed tree and amend if wrong.
  for (const [file, resolved] of resolvedFiles) {
    if (!file.endsWith('.tid')) continue;
    const committed = await gitServer.runGitCommand(workspaceId, ['show', `HEAD:${file}`]);
    const normalizedResolved = resolved.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedCommitted = (committed.stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalizedCommitted !== normalizedResolved) {
      console.warn('merge: committed .tid content wrong (watcher interference), amending', { workspaceId, file });
      await gitServer.writeWorkspaceFile(workspaceId, file, resolved);
      const amendAddResult = await gitServer.runGitCommand(workspaceId, ['add', file]);
      if (amendAddResult.exitCode !== 0) {
        throw new Error(`Failed to stage .tid file for amend: ${file}: ${amendAddResult.stderr}`);
      }
      const amendResult = await gitServer.runGitCommand(workspaceId, ['commit', '--amend', '--no-edit'], { ...DESKTOP_GIT_IDENTITY });
      if (amendResult.exitCode !== 0) {
        throw new Error(`Failed to amend commit with corrected .tid content: ${amendResult.stderr}`);
      }
    }
  }
}

async function mergeMobileIncomingIfExists(gitServer: IGitServerMethods, workspaceId: string): Promise<void> {
  const branchCheck = await gitServer.runGitCommand(workspaceId, ['rev-parse', '--verify', `refs/heads/${MOBILE_BRANCH}`]);
  if (branchCheck.exitCode !== 0 || !branchCheck.stdout.trim()) return;

  await ensureCommittedBeforeMerge(gitServer, workspaceId);

  console.log('Merging mobile-incoming branch into main', { workspaceId });

  const mergeResult = await gitServer.runGitCommand(workspaceId, [
    'merge',
    MOBILE_BRANCH,
    '--no-ff',
    '-m',
    'Merge mobile-incoming (auto-merge by TidGi Desktop)',
  ], { ...DESKTOP_GIT_IDENTITY });

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

      const tidgiService = getTidGiService();

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
      let mergeSummary: string | undefined;
      try {
        const gitServer = tidgiService.gitServer as unknown as IGitServerMethods;
        const headBefore = (await gitServer.runGitCommand(workspaceId, ['rev-parse', 'HEAD'])).stdout.trim();
        await mergeMobileIncomingIfExists(gitServer, workspaceId);
        const headAfter = (await gitServer.runGitCommand(workspaceId, ['rev-parse', 'HEAD'])).stdout.trim();
        if (headAfter !== headBefore) {
          const diffResult = await gitServer.runGitCommand(workspaceId, ['diff-tree', '--no-commit-id', '--name-only', '-r', headAfter]);
          const changedFiles = diffResult.stdout.trim().split('\n').filter((filePath) => filePath.length > 0);
          mergeSummary = formatGitMergeSummary(changedFiles);
        }
      } finally {
        activeMerges.delete(workspaceId);
      }

      updateClientFromRequest(request, mergeSummary !== undefined ? { recentlySyncedString: mergeSummary } : undefined);

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
