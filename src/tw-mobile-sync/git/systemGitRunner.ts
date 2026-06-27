import { type ChildProcess, execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import type { GitRunResult, IGitRunner } from './types';

type GitEnvironmentFactory = (baseEnvironment: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;

/**
 * Git runner backed by the system `git` binary.
 * Used when tw-mobile-sync runs outside TidGi Desktop (e.g. mock server in E2E tests).
 */
export class SystemGitRunner implements IGitRunner {
  constructor(
    private readonly gitBinaryPath = 'git',
    private readonly createEnvironment?: GitEnvironmentFactory,
  ) {}

  private getEnvironment(options?: { env?: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
    const baseEnvironment = { ...process.env, ...(options?.env ?? {}) };
    return this.createEnvironment === undefined ? baseEnvironment : this.createEnvironment(baseEnvironment);
  }

  public run(gitArguments: string[], cwd: string, options?: { env?: NodeJS.ProcessEnv }): Promise<GitRunResult> {
    return new Promise<GitRunResult>((resolve, reject) => {
      const child = execFile(this.gitBinaryPath, gitArguments, {
        cwd,
        env: this.getEnvironment(options),
        maxBuffer: 50 * 1024 * 1024,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({ exitCode, stdout, stderr });
      });
    });
  }

  public spawn(gitArguments: string[], cwd: string, options?: { env?: NodeJS.ProcessEnv }): ChildProcess {
    return spawn(this.gitBinaryPath, gitArguments, {
      cwd,
      env: this.getEnvironment(options),
    });
  }

  public async readFile(cwd: string, relativePath: string): Promise<string | undefined> {
    const fullPath = path.resolve(cwd, relativePath);
    const relative = path.relative(cwd, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path traversal not allowed');
    }
    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  public async writeFile(cwd: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.resolve(cwd, relativePath);
    const relative = path.relative(cwd, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path traversal not allowed');
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  public async writeTempGitFile(cwd: string, fileName: string, data: Uint8Array): Promise<string> {
    const sanitized = path.basename(fileName);
    const filePath = path.join(cwd, '.git', sanitized);
    await fs.writeFile(filePath, Buffer.from(data));
    return filePath;
  }

  public async deleteTempGitFile(cwd: string, fileName: string): Promise<void> {
    const sanitized = path.basename(fileName);
    const filePath = path.join(cwd, '.git', sanitized);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
