import { getSyncedTiddlersText } from '../getSyncedTiddlersText';
import { lingo } from './lingo';

function filePathToTiddlerTitle(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath;
  return basename.replace(/\.tid$/u, '');
}

export function formatGitMergeSummary(changedFiles: string[]): string {
  const tidFiles = changedFiles.filter((filePath) => filePath.endsWith('.tid'));
  if (tidFiles.length === 0) {
    return lingo('GitSync/NoTidChanges');
  }

  const titles = tidFiles.map(filePathToTiddlerTitle);
  return getSyncedTiddlersText(
    titles.map((title) => ({ title, caption: title })),
    [],
    { client: [], server: [] },
    { reverse: true },
  );
}
