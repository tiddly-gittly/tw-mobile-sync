import type { ChildProcess } from 'child_process';
import { ensureCommittedBeforeServe, ensureReceivePackConfig } from './mobileSyncGit';
import type { GitHTTPResponseChunk, IGitRunner, SmartHttpObservable, SmartHttpSubscriber, SmartHttpSubscription } from './types';

const ALLOWED_GIT_SERVICES = new Set(['git-upload-pack', 'git-receive-pack']);

class SmartHttpStream<T> implements SmartHttpObservable<T> {
  constructor(private readonly start: (subscriber: SmartHttpSubscriber<T>) => (() => void) | undefined) {}

  subscribe(subscriber: SmartHttpSubscriber<T>): SmartHttpSubscription {
    const teardown = this.start(subscriber);
    return {
      unsubscribe() {
        teardown?.();
      },
    };
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function runSmartHttpProcess(
  runner: IGitRunner,
  repoPath: string,
  service: string,
  gitArguments: string[],
  requestBody: Uint8Array,
  extraEnvironment?: Record<string, string>,
): SmartHttpObservable<GitHTTPResponseChunk> {
  return new SmartHttpStream<GitHTTPResponseChunk>((subscriber) => {
    let git: ChildProcess | undefined;
    (() => {
      try {
        subscriber.next({
          type: 'headers',
          statusCode: 200,
          headers: {
            'Content-Type': `application/x-${service}-result`,
            'Cache-Control': 'no-cache',
          },
        });

        git = runner.spawn(gitArguments, repoPath, {
          env: { ...process.env, GIT_PROJECT_ROOT: repoPath, GIT_HTTP_EXPORT_ALL: '1', ...extraEnvironment },
        });
        if (!git.stdin || !git.stdout || !git.stderr) {
          throw new Error(`Git stdio streams are unavailable for ${service}`);
        }

        git.stdin.on('error', (error: Error) => {
          console.debug(`${service} stdin error:`, { error: error.message, repoPath });
          git?.kill();
          subscriber.error(error);
        });
        git.stdout.on('data', (data: Buffer) => {
          subscriber.next({ type: 'data', data: new Uint8Array(data) });
        });
        git.stderr.on('data', (data: Buffer) => {
          console.debug(`${service} stderr:`, { data: data.toString(), repoPath });
        });
        git.on('error', (error: Error) => {
          subscriber.error(error);
        });
        git.on('close', (code: number | null) => {
          if (code !== 0 && code !== null) {
            console.error(`${service} exited with non-zero code`, { code, repoPath });
          }
          subscriber.complete();
        });

        git.stdin.end(Buffer.from(requestBody));
      } catch (error) {
        subscriber.error(toError(error));
      }
    })();
    return () => {
      git?.kill();
    };
  });
}

/**
 * Handle Git Smart HTTP info/refs advertisement.
 */
export function handleInfoReferences(
  runner: IGitRunner,
  repoPath: string,
  service: string,
): SmartHttpObservable<GitHTTPResponseChunk> {
  return new SmartHttpStream<GitHTTPResponseChunk>((subscriber) => {
    let git: ChildProcess | undefined;
    void (async () => {
      try {
        if (!ALLOWED_GIT_SERVICES.has(service)) {
          subscriber.next({ type: 'headers', statusCode: 400, headers: { 'Content-Type': 'text/plain' } });
          subscriber.next({ type: 'data', data: new Uint8Array(Buffer.from('Invalid service')) });
          subscriber.complete();
          return;
        }

        if (service === 'git-receive-pack') {
          await ensureReceivePackConfig(runner, repoPath);
        }
        if (service === 'git-upload-pack') {
          await ensureCommittedBeforeServe(runner, repoPath);
        }

        subscriber.next({
          type: 'headers',
          statusCode: 200,
          headers: {
            'Content-Type': `application/x-${service}-advertisement`,
            'Cache-Control': 'no-cache',
          },
        });

        const announcement = `# service=${service}\n`;
        const pktLength = (announcement.length + 4).toString(16).padStart(4, '0');
        subscriber.next({ type: 'data', data: new Uint8Array(Buffer.from(`${pktLength}${announcement}0000`)) });

        git = runner.spawn([service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', repoPath], repoPath, {
          env: { ...process.env, GIT_PROJECT_ROOT: repoPath, GIT_HTTP_EXPORT_ALL: '1' },
        });
        if (!git.stdout || !git.stderr) {
          throw new Error('Git stdio streams are unavailable for info/refs');
        }

        git.stdout.on('data', (data: Buffer) => {
          subscriber.next({ type: 'data', data: new Uint8Array(data) });
        });
        git.stderr.on('data', (data: Buffer) => {
          console.debug('Git info/refs stderr:', { data: data.toString(), repoPath });
        });
        git.on('error', (error: Error) => {
          subscriber.error(error);
        });
        git.on('close', (code: number | null) => {
          if (code !== 0 && code !== null) {
            console.error('Git info/refs exited with non-zero code', { code, repoPath });
          }
          subscriber.complete();
        });
      } catch (error) {
        subscriber.error(toError(error));
      }
    })();
    return () => {
      git?.kill();
    };
  });
}

/**
 * Handle Git Smart HTTP upload-pack (fetch/pull).
 */
export function handleUploadPack(
  runner: IGitRunner,
  repoPath: string,
  requestBody: Uint8Array,
): SmartHttpObservable<GitHTTPResponseChunk> {
  return new SmartHttpStream<GitHTTPResponseChunk>((subscriber) => {
    let innerSubscription: SmartHttpSubscription | undefined;
    void (async () => {
      try {
        await ensureCommittedBeforeServe(runner, repoPath);
        innerSubscription = runSmartHttpProcess(
          runner,
          repoPath,
          'git-upload-pack',
          ['upload-pack', '--stateless-rpc', repoPath],
          requestBody,
        ).subscribe(subscriber);
      } catch (error) {
        subscriber.error(toError(error));
      }
    })();
    return () => {
      innerSubscription?.unsubscribe();
    };
  });
}

/**
 * Handle Git Smart HTTP receive-pack (push).
 */
export function handleReceivePack(
  runner: IGitRunner,
  repoPath: string,
  requestBody: Uint8Array,
): SmartHttpObservable<GitHTTPResponseChunk> {
  return new SmartHttpStream<GitHTTPResponseChunk>((subscriber) => {
    let innerSubscription: SmartHttpSubscription | undefined;
    void (async () => {
      try {
        await ensureCommittedBeforeServe(runner, repoPath);
        await ensureReceivePackConfig(runner, repoPath);
        innerSubscription = runSmartHttpProcess(
          runner,
          repoPath,
          'git-receive-pack',
          ['-c', 'receive.denyCurrentBranch=updateInstead', 'receive-pack', '--stateless-rpc', repoPath],
          requestBody,
        ).subscribe(subscriber);
      } catch (error) {
        subscriber.error(toError(error));
      }
    })();
    return () => {
      innerSubscription?.unsubscribe();
    };
  });
}
