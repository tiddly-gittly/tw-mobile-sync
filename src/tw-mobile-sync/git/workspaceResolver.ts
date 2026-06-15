import type { ITidGiGlobalService } from 'tidgi-shared';

/**
 * Resolve a workspaceId to the git repository path.
 * In TidGi Desktop the workspace service knows the path. In a standalone
 * TiddlyWiki instance (e.g. E2E mock server) there is only one wiki and the
 * path is read from $tw.boot.wikiPath.
 */
export async function getWorkspaceRepoPath(
  workspaceId: string,
  workspaceService?: ITidGiGlobalService['workspace'],
): Promise<string | undefined> {
  if (workspaceService !== undefined) {
    const workspace = await workspaceService.get(workspaceId);
    if (workspace !== undefined && 'wikiFolderLocation' in workspace) {
      return workspace.wikiFolderLocation;
    }
    return undefined;
  }
  // Standalone mode: ignore workspaceId and serve the only available wiki.
  const wikiPath = ($tw as typeof $tw & { boot: { wikiPath?: string } }).boot.wikiPath;
  return wikiPath;
}

/**
 * Determine whether the requested workspace is read-only. In standalone mode
 * we default to writable.
 */
export async function isWorkspaceReadOnly(
  workspaceId: string,
  workspaceService?: ITidGiGlobalService['workspace'],
): Promise<boolean> {
  if (workspaceService === undefined) return false;
  const workspace = await workspaceService.get(workspaceId);
  if (workspace !== undefined && 'readOnlyMode' in workspace) {
    return Boolean((workspace as { readOnlyMode?: boolean }).readOnlyMode);
  }
  return false;
}
