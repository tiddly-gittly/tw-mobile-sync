import path from 'path';
import type { ITidGiGlobalService } from 'tidgi-shared';
import { DesktopGitRunner } from './desktopGitRunner';
import { SystemGitRunner } from './systemGitRunner';
import type { IGitRunner } from './types';

interface IContextServiceLike {
  get(key: string): Promise<unknown>;
}

interface ITidGiGlobalServiceWithContext extends ITidGiGlobalService {
  context?: IContextServiceLike;
}

function getWin32GitSubfolder(): string {
  if (process.arch === 'x64') return 'mingw64';
  if (process.arch === 'arm64') return 'clangarm64';
  return 'mingw32';
}

export function getBundledGitBinaryPath(localGitDirectory: string): string {
  const gitDirectory = path.resolve(localGitDirectory);
  return process.platform === 'win32'
    ? path.join(gitDirectory, 'cmd', 'git.exe')
    : path.join(gitDirectory, 'bin', 'git');
}

function getBundledGitExecPath(localGitDirectory: string): string {
  const gitDirectory = path.resolve(localGitDirectory);
  return process.platform === 'win32'
    ? path.join(gitDirectory, getWin32GitSubfolder(), 'libexec', 'git-core')
    : path.join(gitDirectory, 'libexec', 'git-core');
}

function getPathEnvironmentKey(environment: NodeJS.ProcessEnv): string {
  return Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH';
}

export function createBundledGitEnvironment(localGitDirectory: string, baseEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const gitDirectory = path.resolve(localGitDirectory);
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
  environment.LOCAL_GIT_DIRECTORY = gitDirectory;
  environment.GIT_EXEC_PATH = getBundledGitExecPath(gitDirectory);

  if (process.platform === 'win32') {
    const pathKey = getPathEnvironmentKey(environment);
    const win32GitSubfolder = getWin32GitSubfolder();
    environment[pathKey] = [
      path.join(gitDirectory, win32GitSubfolder, 'bin'),
      path.join(gitDirectory, win32GitSubfolder, 'usr', 'bin'),
      environment[pathKey] ?? '',
    ].join(path.delimiter);
  } else {
    environment.GIT_CONFIG_SYSTEM ??= path.join(gitDirectory, 'etc', 'gitconfig');
    environment.GIT_TEMPLATE_DIR = path.join(gitDirectory, 'share', 'git-core', 'templates');
  }

  if (process.platform === 'linux') {
    environment.PREFIX = gitDirectory;
  }

  return environment;
}

async function getDesktopLocalGitDirectory(tidgiService: ITidGiGlobalServiceWithContext | undefined): Promise<string | undefined> {
  const serviceWithContext = tidgiService;
  const localGitDirectory = await serviceWithContext?.context?.get('LOCAL_GIT_DIRECTORY').catch(() => undefined);
  if (typeof localGitDirectory === 'string' && localGitDirectory.length > 0) {
    return localGitDirectory;
  }

  return process.env.LOCAL_GIT_DIRECTORY;
}

/**
 * Create the appropriate git runner for the current environment.
 * Use TidGi Desktop's gitServer whenever it is available. The system git
 * runner is reserved for standalone Node.js environments such as mock tests.
 */
export function createGitRunner(
  tidgiService: ITidGiGlobalService | undefined,
  workspaceId: string,
): IGitRunner {
  if (tidgiService?.gitServer !== undefined) {
    return new DesktopGitRunner(tidgiService.gitServer, workspaceId);
  }
  return new SystemGitRunner();
}

/**
 * Create a git runner that supports raw process spawning for Smart HTTP.
 * In TidGi Desktop we still spawn locally, but we do so with the bundled git
 * binary path instead of relying on the user's PATH.
 */
export async function createSpawnGitRunner(
  tidgiService: ITidGiGlobalService | undefined,
): Promise<IGitRunner> {
  if (tidgiService?.gitServer !== undefined) {
    const localGitDirectory = await getDesktopLocalGitDirectory(tidgiService);
    if (localGitDirectory === undefined) {
      throw new Error('TidGi Desktop bundled Git directory is unavailable from context service');
    }

    return new SystemGitRunner(
      getBundledGitBinaryPath(localGitDirectory),
      baseEnvironment => createBundledGitEnvironment(localGitDirectory, baseEnvironment),
    );
  }
  return new SystemGitRunner();
}
