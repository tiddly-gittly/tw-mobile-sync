import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseNullDelimitedGitPaths } from '../pathOutput';

void describe('parseNullDelimitedGitPaths', () => {
  void test('preserves Unicode and whitespace in raw Git paths', () => {
    const paths = [
      '$__plugins_linonetwo_health_medicine_500毫克维生素C胶囊.tid',
      'folder/a file with spaces.tid',
      'folder/a\nfile with newline.tid',
      ' leading-and-trailing-space ',
    ];

    assert.deepEqual(parseNullDelimitedGitPaths(`${paths.join('\0')}\0`), paths);
  });

  void test('handles empty output and a missing final delimiter', () => {
    assert.deepEqual(parseNullDelimitedGitPaths(''), []);
    assert.deepEqual(parseNullDelimitedGitPaths('one.tid\0two.tid'), ['one.tid', 'two.tid']);
  });
});
