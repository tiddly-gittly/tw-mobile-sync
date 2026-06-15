import type { ChildProcess } from 'child_process';
import type { IGitServerService } from 'tidgi-shared';
import type { GitRunResult, IGitRunner } from './types';

/**
 * Local shape of the generic git primitives that TidGi Desktop exposes.
 * tidgi-shared may lag behind the desktop implementation, so we cast at the
 * boundary rather than relying on the published type version.
 */
interface IGenericGitServer {
  runGitCommand(workspaceId: string, gitArguments: string[], environment?: Record<string, string>): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  readWorkspaceFile(workspaceId: string, relativePath: string): Promise<string | undefined>;
  writeWorkspaceFile(workspaceId: string, relativePath: string, content: string): Promise<void>;
  writeTempGitFile(workspaceId: string, fileName: string, data: Uint8Array): Promise<string>;
  deleteTempGitFile(workspaceId: string, fileName: string): Promise<void>;
}

/**
 * Git runner that delegates file and command operations to TidGi Desktop's
 * dugite-based gitServer service. It is bound to a single workspaceId because
 * desktop's service resolves the repo path from the workspaceId.
 */
export class DesktopGitRunner implements IGitRunner {
  private readonly genericGitServer: IGenericGitServer;

  constructor(
    gitServer: IGitServerService,
    private readonly workspaceId: string,
  ) {
    this.genericGitServer = gitServer as unknown as IGenericGitServer;
  }

  public async run(gitArguments: string[], _cwd: string, options?: { env?: NodeJS.ProcessEnv }): Promise<GitRunResult> {
    const result = await this.genericGitServer.runGitCommand(this.workspaceId, gitArguments, options?.env as Record<string, string> | undefined);
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  public spawn(_gitArguments: string[], _cwd: string, _options?: { env?: NodeJS.ProcessEnv }): ChildProcess {
    // Smart HTTP streaming is handled directly by desktop's gitServer methods.
    // Endpoints that need streaming should call those or use a system-git runner.
    throw new Error('DesktopGitRunner.spawn is not supported; use gitServer streaming methods');
  }

  public async readFile(_cwd: string, relativePath: string): Promise<string | undefined> {
    return await this.genericGitServer.readWorkspaceFile(this.workspaceId, relativePath);
  }

  public async writeFile(_cwd: string, relativePath: string, content: string): Promise<void> {
    await this.genericGitServer.writeWorkspaceFile(this.workspaceId, relativePath, content);
  }

  public async writeTempGitFile(_cwd: string, fileName: string, data: Uint8Array): Promise<string> {
    return await this.genericGitServer.writeTempGitFile(this.workspaceId, fileName, data);
  }

  public async deleteTempGitFile(_cwd: string, fileName: string): Promise<void> {
    await this.genericGitServer.deleteTempGitFile(this.workspaceId, fileName);
  }
}
