/**
 * Parse paths emitted by Git commands using `-z`.
 *
 * NUL-delimited output is required here: newline-delimited `--name-only`
 * output is quoted according to `core.quotePath`, so non-ASCII paths become
 * octal escape sequences and cannot safely be passed back to Git.
 */
export function parseNullDelimitedGitPaths(output: string): string[] {
  return output.split('\0').filter(path => path.length > 0);
}
