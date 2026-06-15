import type { IGitRunner } from './types';

export const MOBILE_BRANCH = 'mobile-incoming';

export const DESKTOP_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'TidGi Desktop',
  GIT_AUTHOR_EMAIL: 'desktop@tidgi.fun',
  GIT_COMMITTER_NAME: 'TidGi Desktop',
  GIT_COMMITTER_EMAIL: 'desktop@tidgi.fun',
} as const;

export interface TidConflictOptions {
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
 *   the header but GIT produced a conflict block spanning into the body, the block
 *   is split at the blank line: header → theirs wins, body → merge ours + unique theirs.
 */
export function resolveTidConflictMarkers(content: string, options: TidConflictOptions = {}): string {
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
      resolved.push(...oursLines);
      for (const theirsLine of theirsLines) {
        if (!oursLines.includes(theirsLine)) {
          resolved.push(theirsLine);
        }
      }
    } else if (mergeHeaderBodyConflicts) {
      const { header: _oursHeader, body: oursBody } = splitAtBlankLine(oursLines);
      const { header: theirsHeader, body: theirsBody } = splitAtBlankLine(theirsLines);

      if (oursBody.length > 0 || theirsBody.length > 0) {
        resolved.push(...theirsHeader);
        resolved.push('');
        resolved.push(...oursBody);
        for (const theirsBodyLine of theirsBody) {
          if (!oursBody.includes(theirsBodyLine)) {
            resolved.push(theirsBodyLine);
          }
        }
        passedBlankLine = true;
      } else {
        resolved.push(...theirsLines);
        if (!passedBlankLine && theirsLines.includes('')) {
          passedBlankLine = true;
        }
      }
    } else {
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
export function resolveConflictPreferMobile(content: string): string {
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

// ── .tid conflict resolution ────────────────────────────────────────────────

function resolveTidConflict(_runner: IGitRunner, _repoPath: string, _file: string, content: string): string {
  // Marker-based resolution with mergeHeaderBodyConflicts handles both
  // modify/modify and add/add cases correctly for .tid files. The previous
  // 3-way mergeTiddler path was kept for parity with desktop but always
  // returned the marker result, so it has been removed to keep the plugin
  // standalone-friendly (it no longer needs the $tw global at resolve time).
  return resolveTidConflictMarkers(content, { mergeHeaderBodyConflicts: true });
}

// ── Watcher defence helpers ─────────────────────────────────────────────────

async function writeResolvedWithWatcherDefense(
  runner: IGitRunner,
  repoPath: string,
  file: string,
  resolved: string,
): Promise<void> {
  const backoffs = [300, 500, 1000];

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    await runner.writeFile(repoPath, file, resolved);

    if (attempt < backoffs.length) {
      await new Promise<void>(resolveBackoff => {
        setTimeout(resolveBackoff, backoffs[attempt]);
      });

      const onDisk = await runner.readFile(repoPath, file);
      if (onDisk === resolved) {
        return;
      }
      console.warn('merge: watcher overwrote resolved file, retrying', {
        repoPath,
        file,
        attempt: attempt + 1,
        backoffMs: backoffs[attempt],
      });
    }
  }
  await runner.writeFile(repoPath, file, resolved);
  console.warn('merge: exhausted watcher-defense retries, committing best-effort', { repoPath, file });
}

async function getUnmergedFiles(runner: IGitRunner, repoPath: string): Promise<string[]> {
  const unmergedResult = await runner.run(['diff', '--name-only', '--diff-filter=U'], repoPath);
  return unmergedResult.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Resolve all currently-conflicted files and commit.
 * .tid files use TiddlyWiki-aware resolution; all other files prefer mobile.
 */
export async function resolveAllConflicts(runner: IGitRunner, repoPath: string): Promise<void> {
  const conflictedFiles = await getUnmergedFiles(runner, repoPath);
  const resolvedFiles = new Map<string, string>();

  for (const file of conflictedFiles) {
    const content = await runner.readFile(repoPath, file);
    if (!content || !content.includes('<<<<<<<')) {
      const addResult = await runner.run(['add', file], repoPath);
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage conflicted file ${file}: ${addResult.stderr}`);
      }
      continue;
    }

    const resolved = file.endsWith('.tid')
      ? resolveTidConflict(runner, repoPath, file, content)
      : resolveConflictPreferMobile(content);

    await writeResolvedWithWatcherDefense(runner, repoPath, file, resolved);
    resolvedFiles.set(file, resolved);

    const addResult = await runner.run(['add', file], repoPath);
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage resolved conflict for ${file}: ${addResult.stderr}`);
    }

    if (file.endsWith('.tid')) {
      const staged = await runner.run(['show', `:${file}`], repoPath);
      const normalizedResolved = resolved.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedStaged = (staged.stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (normalizedStaged !== normalizedResolved) {
        console.warn('merge: watcher overwrote staged .tid file, re-defending', { repoPath, file });
        await runner.writeFile(repoPath, file, resolved);
        const reAddResult = await runner.run(['add', file], repoPath);
        if (reAddResult.exitCode !== 0) {
          throw new Error(`Failed to re-stage resolved conflict for ${file}: ${reAddResult.stderr}`);
        }
      }
    }
  }

  for (const [file, resolved] of resolvedFiles) {
    const onDisk = await runner.readFile(repoPath, file);
    if (onDisk !== resolved) {
      console.warn('merge: watcher overwrote file during batch, re-defending before commit', { repoPath, file });
      await writeResolvedWithWatcherDefense(runner, repoPath, file, resolved);
      const addResult = await runner.run(['add', file], repoPath);
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to re-stage resolved conflict for ${file}: ${addResult.stderr}`);
      }
    }
  }

  const commitResult = await runner.run(['commit', '--no-edit'], repoPath, { env: { ...process.env, ...DESKTOP_GIT_IDENTITY } });
  if (commitResult.exitCode !== 0) {
    throw new Error(`Failed to commit resolved conflicts: ${commitResult.stderr}`);
  }

  const tidFiles = conflictedFiles.filter((f: string) => f.endsWith('.tid'));
  if (tidFiles.length > 0) {
    await runner.run(['checkout', 'HEAD', '--', ...tidFiles], repoPath);
  }

  for (const [file, resolved] of resolvedFiles) {
    if (!file.endsWith('.tid')) continue;
    const committed = await runner.run(['show', `HEAD:${file}`], repoPath);
    const normalizedResolved = resolved.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedCommitted = (committed.stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalizedCommitted !== normalizedResolved) {
      console.warn('merge: committed .tid content wrong (watcher interference), amending', { repoPath, file });
      await runner.writeFile(repoPath, file, resolved);
      const amendAddResult = await runner.run(['add', file], repoPath);
      if (amendAddResult.exitCode !== 0) {
        throw new Error(`Failed to stage .tid file for amend: ${file}: ${amendAddResult.stderr}`);
      }
      const amendResult = await runner.run(['commit', '--amend', '--no-edit'], repoPath, { env: { ...process.env, ...DESKTOP_GIT_IDENTITY } });
      if (amendResult.exitCode !== 0) {
        throw new Error(`Failed to amend commit with corrected .tid content: ${amendResult.stderr}`);
      }
    }
  }
}

/**
 * Merge mobile-incoming branch into main and clean up.
 * No-op if the branch does not exist.
 */
export async function mergeMobileIncomingIfExists(runner: IGitRunner, repoPath: string): Promise<void> {
  const branchCheck = await runner.run(['rev-parse', '--verify', `refs/heads/${MOBILE_BRANCH}`], repoPath);
  if (branchCheck.exitCode !== 0 || !branchCheck.stdout.trim()) return;

  await ensureCommittedBeforeMerge(runner, repoPath);

  console.log('Merging mobile-incoming branch into main', { repoPath });

  const mergeResult = await runner.run(
    ['merge', MOBILE_BRANCH, '--no-ff', '-m', 'Merge mobile-incoming (auto-merge by TidGi Desktop)'],
    repoPath,
    { env: { ...process.env, ...DESKTOP_GIT_IDENTITY } },
  );

  if (mergeResult.exitCode !== 0) {
    console.log('Merge conflicts detected, auto-resolving', { repoPath, stderr: mergeResult.stderr });
    const conflictedFiles = await getUnmergedFiles(runner, repoPath);
    if (conflictedFiles.length === 0) {
      throw new Error(`Merge failed before conflict markers were created: ${mergeResult.stderr || mergeResult.stdout}`);
    }
    await resolveAllConflicts(runner, repoPath);
  }

  const deleteBranchResult = await runner.run(['branch', '-D', MOBILE_BRANCH], repoPath);
  if (deleteBranchResult.exitCode !== 0) {
    throw new Error(`Failed to delete ${MOBILE_BRANCH}: ${deleteBranchResult.stderr}`);
  }

  console.log('Mobile-incoming merge complete', { repoPath });
}

/**
 * Auto-commit pending desktop changes before a merge or before serving the repo.
 */
export async function ensureCommittedBeforeMerge(runner: IGitRunner, repoPath: string): Promise<void> {
  await runner.run(['-c', 'core.fsmonitor=false', 'update-index', '--really-refresh'], repoPath);

  const addResult = await runner.run(['-c', 'core.fsmonitor=false', 'add', '-A'], repoPath);
  if (addResult.exitCode !== 0) {
    throw new Error(`git add failed before merge: ${addResult.stderr}`);
  }

  const diffResult = await runner.run(['diff', '--cached', '--quiet'], repoPath);
  if (diffResult.exitCode === 0) return;

  const commitResult = await runner.run(
    ['commit', '-m', `Auto commit before mobile merge ${new Date().toISOString()}`],
    repoPath,
    { env: { ...process.env, ...DESKTOP_GIT_IDENTITY } },
  );
  if (commitResult.exitCode !== 0) {
    throw new Error(`git commit failed before merge: ${commitResult.stderr}`);
  }
}
