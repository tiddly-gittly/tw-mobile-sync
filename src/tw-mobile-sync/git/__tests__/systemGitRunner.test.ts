import assert from 'node:assert';
import { describe, test } from 'node:test';
import { SystemGitRunner } from '../systemGitRunner';

/**
 * Unit tests for SystemGitRunner.
 *
 * These tests verify that the runner correctly rejects path traversal attacks
 * and delegates file operations. Git subprocess tests require a real git repo
 * and are covered by the E2E mock-server suite.
 */
void describe('SystemGitRunner', () => {
  void test('readFile should reject parent-directory traversal', async () => {
    const runner = new SystemGitRunner();
    await assert.rejects(
      () => runner.readFile('/repo', '../../etc/passwd'),
      /Path traversal not allowed/,
    );
  });

  void test('readFile should reject absolute traversal paths', async () => {
    const runner = new SystemGitRunner();
    await assert.rejects(
      () => runner.readFile('/repo', '/etc/passwd'),
      /Path traversal not allowed/,
    );
  });

  void test('writeFile should reject parent-directory traversal', async () => {
    const runner = new SystemGitRunner();
    await assert.rejects(
      () => runner.writeFile('/repo', '../../etc/passwd', 'evil'),
      /Path traversal not allowed/,
    );
  });

  void test('writeFile should reject absolute traversal paths', async () => {
    const runner = new SystemGitRunner();
    await assert.rejects(
      () => runner.writeFile('/repo', '/etc/passwd', 'evil'),
      /Path traversal not allowed/,
    );
  });

  void test('readFile should return undefined for non-existent file', async () => {
    const runner = new SystemGitRunner();
    const result = await runner.readFile('.', `__no_such_file_${Date.now()}.tmp`);
    assert.strictEqual(result, undefined);
  });

  void test('deleteTempGitFile should not throw on non-existent file', async () => {
    const runner = new SystemGitRunner();
    await assert.doesNotReject(
      () => runner.deleteTempGitFile('.', '__non_existent_lockfile.tmp'),
    );
  });
});
