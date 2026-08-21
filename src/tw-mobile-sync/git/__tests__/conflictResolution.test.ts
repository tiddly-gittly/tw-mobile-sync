import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { mergeMobileIncomingIfExists } from '../conflictResolution';
import { SystemGitRunner } from '../systemGitRunner';
import type { GitRunResult, IGitRunner } from '../types';

const ok = (stdout = ''): GitRunResult => ({ exitCode: 0, stderr: '', stdout });
const failed = (stderr = ''): GitRunResult => ({ exitCode: 1, stderr, stdout: '' });

void describe('mergeMobileIncomingIfExists', () => {
  void test('resolves a real Git conflict whose path contains Unicode', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'tw-mobile-sync-unicode-conflict-'));
    const unicodePath = 'tiddlers/500毫克维生素C胶囊.tid';
    const runner = new SystemGitRunner();
    const run = async (arguments_: string[]) => {
      const result = await runner.run(arguments_, repoPath);
      assert.equal(result.exitCode, 0, `${arguments_.join(' ')} failed: ${result.stderr}`);
      return result;
    };

    try {
      await run(['init', '--initial-branch=master']);
      await run(['config', 'user.name', 'Test']);
      await run(['config', 'user.email', 'test@example.com']);
      await mkdir(join(repoPath, 'tiddlers'));
      await writeFile(join(repoPath, unicodePath), 'title: Vitamin C\n\nbase\n', 'utf8');
      await run(['add', unicodePath]);
      await run(['commit', '-m', 'base']);

      await run(['checkout', '-b', 'mobile-incoming']);
      await writeFile(join(repoPath, unicodePath), 'title: Vitamin C Mobile\n\nmobile\n', 'utf8');
      await run(['add', unicodePath]);
      await run(['commit', '-m', 'mobile']);

      await run(['checkout', 'master']);
      await writeFile(join(repoPath, unicodePath), 'title: Vitamin C Desktop\n\ndesktop\n', 'utf8');
      await run(['add', unicodePath]);
      await run(['commit', '-m', 'desktop']);

      await mergeMobileIncomingIfExists(runner, repoPath);

      const status = await run(['status', '--porcelain']);
      assert.equal(status.stdout, '');
      const incoming = await runner.run(['rev-parse', '--verify', 'refs/heads/mobile-incoming'], repoPath);
      assert.notEqual(incoming.exitCode, 0);
      const merged = await readFile(join(repoPath, unicodePath), 'utf8');
      assert.match(merged, /Vitamin C Mobile/);
    } finally {
      await rm(repoPath, { force: true, recursive: true });
    }
  });

  void test('passes a raw Unicode conflict path back to Git and aborts after resolution failure', async () => {
    const unicodePath = '$__plugins_linonetwo_health_medicine_500毫克维生素C胶囊.tid';
    const calls: string[][] = [];
    let mergeHeadChecks = 0;
    const runner: IGitRunner = {
      deleteTempGitFile() {
        return Promise.resolve();
      },
      readFile() {
        return Promise.resolve(undefined);
      },
      run(arguments_) {
        calls.push(arguments_);
        if (arguments_[0] === 'rev-parse' && arguments_[2] === 'refs/heads/mobile-incoming') return Promise.resolve(ok('incoming\n'));
        if (arguments_[0] === 'rev-parse' && arguments_[2] === 'MERGE_HEAD') {
          mergeHeadChecks++;
          return Promise.resolve(mergeHeadChecks === 1 ? failed() : ok('merge-head\n'));
        }
        if (arguments_[0] === '-c' && arguments_.includes('update-index')) return Promise.resolve(ok());
        if (arguments_[0] === '-c' && arguments_.includes('add')) return Promise.resolve(ok());
        if (arguments_[0] === 'diff' && arguments_.includes('--cached')) return Promise.resolve(ok());
        if (arguments_[0] === 'merge' && arguments_[1] === 'mobile-incoming') return Promise.resolve(failed('CONFLICT'));
        if (arguments_[0] === 'diff' && arguments_.includes('--diff-filter=U')) return Promise.resolve(ok(`${unicodePath}\0`));
        if (arguments_[0] === 'add' && arguments_[1] === '--' && arguments_[2] === unicodePath) {
          return Promise.resolve(failed('injected staging failure'));
        }
        if (arguments_[0] === 'merge' && arguments_[1] === '--abort') return Promise.resolve(ok());
        throw new Error(`Unexpected git command: ${arguments_.join(' ')}`);
      },
      spawn(): ChildProcess {
        throw new Error('not used');
      },
      writeFile() {
        return Promise.resolve();
      },
      writeTempGitFile() {
        return Promise.resolve('');
      },
    };

    await assert.rejects(
      () => mergeMobileIncomingIfExists(runner, '/repo'),
      /injected staging failure/,
    );
    assert.ok(calls.some(arguments_ => arguments_[0] === 'add' && arguments_[1] === '--' && arguments_[2] === unicodePath));
    assert.ok(calls.some(arguments_ => arguments_[0] === 'merge' && arguments_[1] === '--abort'));
    assert.ok(!calls.some(arguments_ => arguments_[0] === 'branch' && arguments_[1] === '-D'));
  });

  void test('does not stage files when a merge is already in progress', async () => {
    const calls: string[][] = [];
    const runner = {
      run(arguments_: string[]) {
        calls.push(arguments_);
        if (arguments_[0] === 'rev-parse' && arguments_[2] === 'refs/heads/mobile-incoming') return Promise.resolve(ok('incoming\n'));
        if (arguments_[0] === 'rev-parse' && arguments_[2] === 'MERGE_HEAD') return Promise.resolve(ok('merge-head\n'));
        throw new Error(`Unexpected git command: ${arguments_.join(' ')}`);
      },
    } as unknown as IGitRunner;

    await assert.rejects(
      () => mergeMobileIncomingIfExists(runner, '/repo'),
      /already has a merge in progress/,
    );
    assert.ok(!calls.some(arguments_ => arguments_.includes('add')));
  });
});
