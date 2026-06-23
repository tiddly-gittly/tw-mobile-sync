import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatGitMergeSummary } from '../formatGitSyncSummary';

void describe('formatGitMergeSummary', () => {
  void test('formats merged .tid files as a mobile sync summary', () => {
    const summary = formatGitMergeSummary(['notes/foo.tid', 'README.md', 'bar.tid']);
    assert.match(summary, /↓ 2/);
    assert.match(summary, /foo/);
    assert.match(summary, /bar/);
  });

  void test('handles empty changes', () => {
    const summary = formatGitMergeSummary(['README.md']);
    assert.equal(summary, 'Git sync complete (no .tid changes)');
  });
});
