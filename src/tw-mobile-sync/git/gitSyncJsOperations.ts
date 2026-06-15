/**
 * Thin dynamic importer for git-sync-js.
 *
 * git-sync-js is intentionally NOT listed as a production dependency of this
 * plugin, because TidGi Desktop already provides it. In standalone
 * environments (e.g. E2E mock servers), the host project can install
 * git-sync-js and this module will resolve it at runtime.
 *
 * This keeps the plugin bundle small while still allowing git-sync-js
 * operations to run outside desktop's git worker.
 */

export interface IGitUserInfos {
  accessToken: string;
  email: string;
  login: string;
}

export interface IDefaultGitInfo {
  email: string;
  gitUserName: string;
}

export interface ILoggerContext {
  [key: string]: unknown;
}

export interface ILogger {
  debug: (message: string, context: ILoggerContext) => void;
  info: (message: string, context: ILoggerContext) => void;
  warn: (message: string, context: ILoggerContext) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GitSyncJsModule = any;

function getGitSyncJs(): GitSyncJsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('git-sync-js');
}

/**
 * Run git-sync-js initGit outside desktop's git worker.
 */
export async function initGit(options: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { initGit: init } = getGitSyncJs();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  await init(options);
}

/**
 * Run git-sync-js commitAndSync outside desktop's git worker.
 */
export async function commitAndSync(options: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { commitAndSync: sync } = getGitSyncJs();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  await sync(options);
}

/**
 * Run git-sync-js forcePull outside desktop's git worker.
 */
export async function forcePull(options: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { forcePull: pull } = getGitSyncJs();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  await pull(options);
}

/**
 * Run git-sync-js clone outside desktop's git worker.
 */
export async function clone(options: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { clone: cloneRepo } = getGitSyncJs();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  await cloneRepo(options);
}

/**
 * Inspect helper from git-sync-js.
 */
export async function hasGit(directory: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const inspectModule = require('git-sync-js/dist/src/inspect.js') as { hasGit: (directory: string) => boolean | Promise<boolean> };
  return await inspectModule.hasGit(directory);
}
