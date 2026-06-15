import type { IGitServerService, ITidGiGlobalService } from 'tidgi-shared';
import { getGitRunnerPreference } from './config';
import { DesktopGitRunner } from './desktopGitRunner';
import { SystemGitRunner } from './systemGitRunner';
import type { IGitRunner } from './types';

/**
 * Create the appropriate git runner for the current environment and config.
 * @param workspaceId Required when delegating to desktop; ignored by system runner.
 */
export function createGitRunner(
  tidgiService: ITidGiGlobalService | undefined,
  workspaceId: string,
): IGitRunner {
  const preference = getGitRunnerPreference();
  const canUseDesktop = tidgiService?.gitServer !== undefined && preference === 'desktop';
  if (canUseDesktop) {
    return new DesktopGitRunner(tidgiService.gitServer as IGitServerService, workspaceId);
  }
  return new SystemGitRunner();
}
