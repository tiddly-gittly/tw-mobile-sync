import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { DESKTOP_GIT_IDENTITY } from './conflictResolution';
import type { IGitRunner } from './types';

/**
 * Auto-commit pending changes before serving the repo to a mobile client.
 * This is the server-side counterpart of ensureCommittedBeforeMerge.
 */
export async function ensureCommittedBeforeServe(runner: IGitRunner, repoPath: string): Promise<void> {
  await runner.run(['-c', 'core.fsmonitor=false', 'update-index', '--really-refresh'], repoPath);

  const { exitCode: addCode, stderr: addStderr } = await runner.run(
    ['-c', 'core.fsmonitor=false', 'add', '-A'],
    repoPath,
  );
  if (addCode !== 0) {
    console.warn('git add -A failed before mobile sync', { repoPath, addCode, addStderr });
    return;
  }

  const { exitCode: diffCode } = await runner.run(['diff', '--cached', '--quiet'], repoPath);
  if (diffCode === 0) return;

  const { exitCode: commitCode, stderr: commitStderr } = await runner.run(
    ['commit', '-m', `Auto commit before mobile sync ${new Date().toISOString()}`],
    repoPath,
    { env: { ...process.env, ...DESKTOP_GIT_IDENTITY } },
  );
  if (commitCode !== 0) {
    console.warn('Auto commit before mobile sync failed (ignored)', { repoPath, commitCode, commitStderr });
    return;
  }

  const { exitCode: gcCode } = await runner.run(['gc', '--auto', '--quiet'], repoPath);
  if (gcCode !== 0) {
    console.debug('git gc --auto returned non-zero (non-fatal)', { repoPath, gcCode });
  }
}

/**
 * Configure receive.denyCurrentBranch so pushes can update the checked-out branch.
 */
export async function ensureReceivePackConfig(runner: IGitRunner, repoPath: string): Promise<void> {
  await runner.run(['config', 'receive.denyCurrentBranch', 'updateInstead'], repoPath);
}

/**
 * In-memory cache: repoPath → { commitHash, archivePath, timestamp }.
 * Invalidated when HEAD changes.
 */
const archiveCache = new Map<string, { commitHash: string; archivePath: string; timestamp: number }>();

/**
 * Generate (or return cached) a tar archive of the workspace repo.
 * The archive contains the working tree plus a minimal .git directory so
 * mobile clients can fast-clone without resolving deltas in JS.
 */
export async function generateFullArchive(
  runner: IGitRunner,
  repoPath: string,
): Promise<{ archivePath: string; commitHash: string; sizeBytes: number } | undefined> {
  await ensureCommittedBeforeServe(runner, repoPath);

  const commitHash = (await runner.run(['rev-parse', 'HEAD'], repoPath)).stdout.trim();
  if (!commitHash) return undefined;

  const cached = archiveCache.get(repoPath);
  if (cached && cached.commitHash === commitHash) {
    try {
      const stat = await fs.stat(cached.archivePath);
      return { archivePath: cached.archivePath, commitHash, sizeBytes: stat.size };
    } catch {
      // Cache file gone, regenerate
    }
  }

  console.log('Generating full archive for mobile sync', { repoPath, commitHash });

  const cacheDirectory = path.join(repoPath, '.git', 'tidgi-archive-cache');
  await fs.mkdir(cacheDirectory, { recursive: true });
  const archivePath = path.join(cacheDirectory, `full-archive-${commitHash.slice(0, 12)}.tar`);

  try {
    for (const file of await fs.readdir(cacheDirectory)) {
      if (file.startsWith('full-archive-') && file !== path.basename(archivePath)) {
        await fs.unlink(path.join(cacheDirectory, file)).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }

  try {
    const stat = await fs.stat(archivePath);
    archiveCache.set(repoPath, { commitHash, archivePath, timestamp: Date.now() });
    return { archivePath, commitHash, sizeBytes: stat.size };
  } catch { /* need to generate */ }

  const { exitCode: archiveCode } = await runner.run(
    ['archive', '--format=tar', '-o', archivePath, 'HEAD'],
    repoPath,
  );
  if (archiveCode !== 0) {
    console.error('git archive failed', { repoPath, archiveCode });
    return undefined;
  }

  const stagingDirectory = path.join(cacheDirectory, 'staging');
  const stagingGit = path.join(stagingDirectory, '.git');
  await fs.rm(stagingDirectory, { recursive: true, force: true });

  const gitDirectory = path.join(repoPath, '.git');

  await fs.mkdir(stagingGit, { recursive: true });
  await fs.copyFile(path.join(gitDirectory, 'HEAD'), path.join(stagingGit, 'HEAD'));

  const configContent = [
    '[core]',
    '\trepositoryformatversion = 0',
    '\tfilemode = false',
    '\tbare = false',
    '[remote "origin"]',
    '\turl = PLACEHOLDER',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    '',
  ].join('\n');
  await fs.writeFile(path.join(stagingGit, 'config'), configContent);

  try {
    await fs.copyFile(path.join(gitDirectory, 'packed-refs'), path.join(stagingGit, 'packed-refs'));
  } catch { /* optional */ }

  try {
    await fs.copyFile(path.join(gitDirectory, 'shallow'), path.join(stagingGit, 'shallow'));
  } catch { /* optional */ }

  await copyDirectoryRecursive(path.join(gitDirectory, 'refs'), path.join(stagingGit, 'refs'));

  const sourcePackDirectory = path.join(gitDirectory, 'objects', 'pack');
  const destinationPackDirectory = path.join(stagingGit, 'objects', 'pack');
  try {
    const packFiles = await fs.readdir(sourcePackDirectory);
    if (packFiles.length > 0) {
      await fs.mkdir(destinationPackDirectory, { recursive: true });
      for (const f of packFiles) {
        if (f.endsWith('.pack') || f.endsWith('.idx')) {
          await fs.copyFile(path.join(sourcePackDirectory, f), path.join(destinationPackDirectory, f));
        }
      }
    }
  } catch { /* no pack files */ }

  const sourceObjectDirectory = path.join(gitDirectory, 'objects');
  try {
    for (const entry of await fs.readdir(sourceObjectDirectory)) {
      if (entry.length === 2 && /^[\da-f]{2}$/.test(entry)) {
        const sourceSubDirectory = path.join(sourceObjectDirectory, entry);
        const destinationSubDirectory = path.join(stagingGit, 'objects', entry);
        await copyDirectoryRecursive(sourceSubDirectory, destinationSubDirectory);
      }
    }
  } catch { /* no loose objects */ }

  await new Promise<void>((resolve, reject) => {
    execFile(
      'tar',
      ['--append', '-f', archivePath, '-C', stagingDirectory, '.git'],
      { timeout: 120_000 },
      (error) => {
        if (error) reject(error instanceof Error ? error : new Error('tar append failed'));
        else resolve();
      },
    );
  });

  await fs.rm(stagingDirectory, { recursive: true, force: true });

  const stat = await fs.stat(archivePath);
  archiveCache.set(repoPath, { commitHash, archivePath, timestamp: Date.now() });

  console.log('Full archive generated', { repoPath, commitHash, sizeBytes: stat.size });
  return { archivePath, commitHash, sizeBytes: stat.size };
}

async function copyDirectoryRecursive(source: string, destination: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(source);
  } catch {
    return;
  }
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const destinationPath = path.join(destination, entry);
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else if (stat.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}
