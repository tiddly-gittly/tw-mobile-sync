import type { ChildProcess } from 'child_process';
import type { Observable } from 'rxjs';

/**
 * A chunk of Git Smart HTTP response transported via Observable.
 * First emission carries headers, subsequent ones carry data.
 */
export type GitHTTPResponseChunk =
  | { type: 'headers'; statusCode: number; headers: Record<string, string> }
  | { type: 'data'; data: Uint8Array };

/**
 * Result of a collected git command execution.
 */
export interface GitRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Abstraction over git execution so the plugin can run inside TidGi Desktop
 * (delegating to desktop's dugite-based service) or in a standalone
 * TiddlyWiki Node.js instance (using the system git binary).
 */
export interface IGitRunner {
  /**
   * Run a git command and collect stdout/stderr as strings.
   */
  run(gitArguments: string[], cwd: string, options?: { env?: NodeJS.ProcessEnv }): Promise<GitRunResult>;

  /**
   * Spawn a git process with stdio streams. Used for Smart HTTP protocol.
   */
  spawn(gitArguments: string[], cwd: string, options?: { env?: NodeJS.ProcessEnv }): ChildProcess;

  /**
   * Read a file relative to the repo root.
   */
  readFile(cwd: string, relativePath: string): Promise<string | undefined>;

  /**
   * Write a file relative to the repo root.
   */
  writeFile(cwd: string, relativePath: string, content: string): Promise<void>;

  /**
   * Write a temporary file inside the repo's .git directory.
   * @returns the absolute path of the written file.
   */
  writeTempGitFile(cwd: string, fileName: string, data: Uint8Array): Promise<string>;

  /**
   * Delete a temporary file inside the repo's .git directory.
   */
  deleteTempGitFile(cwd: string, fileName: string): Promise<void>;
}

/**
 * Shape of a function that can produce an Observable of Smart HTTP chunks.
 */
export type SmartHttpHandler = (repoPath: string, requestBody: Uint8Array, runner: IGitRunner, options?: { readOnlyMode?: boolean }) => Observable<GitHTTPResponseChunk>;
