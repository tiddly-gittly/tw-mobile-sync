const CONFIG_TITLE = '$:/plugins/linonetwo/tw-mobile-sync/Config/GitRunner';

/**
 * Read the plugin's git runner preference.
 * - "desktop"     -> delegate to TidGi Desktop's dugite-based gitServer.
 * - "system"      -> use the system `git` binary directly.
 */
export type GitRunnerPreference = 'desktop' | 'system';

export function getGitRunnerPreference(): GitRunnerPreference {
  const value = ($tw).wiki.getTiddlerText(CONFIG_TITLE)?.trim().toLowerCase();
  if (value === 'desktop' || value === 'system') {
    return value;
  }
  return 'system';
}
