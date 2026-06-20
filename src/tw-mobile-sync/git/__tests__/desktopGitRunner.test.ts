import assert from 'node:assert';
import { describe, test } from 'node:test';
import type { IGitServerService } from 'tidgi-shared';
import { DesktopGitRunner } from '../desktopGitRunner';

/**
 * Unit tests for DesktopGitRunner.
 *
 * These tests run directly under Node.js (tsx) and verify that the runner
 * correctly delegates git commands and file operations to TidGi Desktop's
 * gitServer service. They do not require a running TiddlyWiki instance.
 */

void describe('DesktopGitRunner', () => {
  const WORKSPACE_ID = 'test-workspace';

  function createMockGitServer(): IGitServerService & {
    calls: Array<{ method: string; args: unknown[] }>;
    reset(): void;
  } {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    return {
      calls,
      reset: () => {
        calls.length = 0;
      },
      runGitCommand: (workspaceId: string, gitArguments: string[], environment?: Record<string, string>) => {
        calls.push({ method: 'runGitCommand', args: [workspaceId, gitArguments, environment] });
        return Promise.resolve({ exitCode: 0, stdout: 'mock-stdout', stderr: 'mock-stderr' });
      },
      readWorkspaceFile: (workspaceId: string, relativePath: string) => {
        calls.push({ method: 'readWorkspaceFile', args: [workspaceId, relativePath] });
        return Promise.resolve('mock-file-content');
      },
      writeWorkspaceFile: (workspaceId: string, relativePath: string, content: string) => {
        calls.push({ method: 'writeWorkspaceFile', args: [workspaceId, relativePath, content] });
        return Promise.resolve();
      },
      writeTempGitFile: (workspaceId: string, fileName: string, data: Uint8Array) => {
        calls.push({ method: 'writeTempGitFile', args: [workspaceId, fileName, data] });
        return Promise.resolve(`C:/mock/${fileName}`);
      },
      deleteTempGitFile: (workspaceId: string, fileName: string) => {
        calls.push({ method: 'deleteTempGitFile', args: [workspaceId, fileName] });
        return Promise.resolve();
      },
    } as unknown as IGitServerService & { calls: Array<{ method: string; args: unknown[] }>; reset(): void };
  }

  void test('should delegate run() to runGitCommand with correct arguments', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    const result = await runner.run(['status', '--short'], '/ignored/cwd', { env: { GIT_TRACE: '1' } });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, 'mock-stdout');
    assert.strictEqual(result.stderr, 'mock-stderr');
    assert.strictEqual(mock.calls.length, 1);
    assert.strictEqual(mock.calls[0].method, 'runGitCommand');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, ['status', '--short'], { GIT_TRACE: '1' }]);
  });

  void test('should default exitCode to 0 when desktop returns null', async () => {
    const mock = createMockGitServer();
    mock.runGitCommand = () => Promise.resolve({ exitCode: null, stdout: '', stderr: '' });
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    const result = await runner.run(['log'], '/ignored/cwd');

    assert.strictEqual(result.exitCode, 0);
  });

  void test('should pass undefined env when options is omitted', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    await runner.run(['rev-parse', 'HEAD'], '/ignored/cwd');

    assert.strictEqual(mock.calls[0].method, 'runGitCommand');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, ['rev-parse', 'HEAD'], undefined]);
  });

  void test('should throw when spawn() is called', () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    assert.throws(
      () => runner.spawn(['upload-pack'], '/ignored/cwd'),
      /DesktopGitRunner\.spawn is not supported/,
    );
  });

  void test('should delegate readFile() to readWorkspaceFile', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    const content = await runner.readFile('/ignored/cwd', 'tiddlers/Hello.tid');

    assert.strictEqual(content, 'mock-file-content');
    assert.strictEqual(mock.calls[0].method, 'readWorkspaceFile');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, 'tiddlers/Hello.tid']);
  });

  void test('should delegate writeFile() to writeWorkspaceFile', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    await runner.writeFile('/ignored/cwd', 'tiddlers/Hello.tid', 'new content');

    assert.strictEqual(mock.calls[0].method, 'writeWorkspaceFile');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, 'tiddlers/Hello.tid', 'new content']);
  });

  void test('should delegate writeTempGitFile() and return the temp path', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);
    const data = new TextEncoder().encode('bundle');

    const path = await runner.writeTempGitFile('/ignored/cwd', 'incoming.bundle', data);

    assert.strictEqual(path, 'C:/mock/incoming.bundle');
    assert.strictEqual(mock.calls[0].method, 'writeTempGitFile');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, 'incoming.bundle', data]);
  });

  void test('should delegate deleteTempGitFile()', async () => {
    const mock = createMockGitServer();
    const runner = new DesktopGitRunner(mock as IGitServerService, WORKSPACE_ID);

    await runner.deleteTempGitFile('/ignored/cwd', 'incoming.bundle');

    assert.strictEqual(mock.calls[0].method, 'deleteTempGitFile');
    assert.deepStrictEqual(mock.calls[0].args, [WORKSPACE_ID, 'incoming.bundle']);
  });
});
