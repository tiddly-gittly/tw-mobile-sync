import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { DesktopGitRunner } from '../desktopGitRunner';
import { createBundledGitEnvironment, createGitRunner, createSpawnGitRunner, getBundledGitBinaryPath } from '../gitRunnerFactory';
import { SystemGitRunner } from '../systemGitRunner';

void describe('createGitRunner', () => {
  void test('uses DesktopGitRunner when TidGi Desktop gitServer is available', () => {
    const tidgiService = {
      gitServer: {},
    } as ITidGiGlobalService;

    const runner = createGitRunner(tidgiService, 'workspace-id');

    assert.ok(runner instanceof DesktopGitRunner);
  });

  void test('falls back to SystemGitRunner only when no desktop gitServer exists', () => {
    const runner = createGitRunner(undefined, 'workspace-id');

    assert.ok(runner instanceof SystemGitRunner);
  });

  void test('uses existing desktop context to locate bundled git for spawn-capable runners', async () => {
    const localGitDirectory = path.resolve('desktop-resources', 'node_modules', 'dugite', 'git');
    const tidgiService = {
      gitServer: {},
      context: {
        get: (key: string) => {
          assert.strictEqual(key, 'LOCAL_GIT_DIRECTORY');
          return Promise.resolve(localGitDirectory);
        },
      },
    } as unknown as ITidGiGlobalService;

    const runner = await createSpawnGitRunner(tidgiService);

    assert.ok(runner instanceof SystemGitRunner);
    assert.strictEqual((runner as unknown as { gitBinaryPath: string }).gitBinaryPath, getBundledGitBinaryPath(localGitDirectory));
  });

  void test('creates a bundled git environment compatible with dugite', () => {
    const localGitDirectory = path.resolve('desktop-resources', 'node_modules', 'dugite', 'git');
    const environment = createBundledGitEnvironment(localGitDirectory, { PATH: 'system-path' });

    assert.strictEqual(environment.LOCAL_GIT_DIRECTORY, localGitDirectory);
    assert.ok(environment.GIT_EXEC_PATH?.includes('git-core'));
    if (process.platform === 'win32') {
      assert.ok(
        environment.PATH?.startsWith(path.join(localGitDirectory, process.arch === 'arm64' ? 'clangarm64' : 'mingw64')),
      );
    }
  });

  void test('does not fall back to PATH git when desktop context lacks bundled git path', async () => {
    const tidgiService = {
      gitServer: {},
      context: {
        get: () => Promise.resolve(undefined),
      },
    } as unknown as ITidGiGlobalService;

    const originalLocalGitDirectory = process.env.LOCAL_GIT_DIRECTORY;
    delete process.env.LOCAL_GIT_DIRECTORY;
    try {
      await assert.rejects(
        () => createSpawnGitRunner(tidgiService),
        /bundled Git directory is unavailable/,
      );
    } finally {
      process.env.LOCAL_GIT_DIRECTORY = originalLocalGitDirectory;
    }
  });

  void test('falls back to PATH git for spawn-capable runners outside desktop', async () => {
    const runner = await createSpawnGitRunner(undefined);

    assert.ok(runner instanceof SystemGitRunner);
    assert.strictEqual((runner as unknown as { gitBinaryPath: string }).gitBinaryPath, 'git');
  });
});
