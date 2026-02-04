/**
 * Type definitions for TidGi Desktop services exposed to TiddlyWiki plugins
 * These types match the services available in TidGi-Desktop's wiki worker
 */

declare namespace TidGiGlobal {
  /**
   * Git service interface for version control operations
   */
  interface IGitService {
    /**
     * Get deleted tiddler titles from git history since a specific date
     * @param wikiFolderPath - Path to the wiki folder
     * @param sinceDate - Date to check for deletions after this time
     * @returns Array of deleted tiddler titles
     */
    getDeletedTiddlersSinceDate(wikiFolderPath: string, sinceDate: Date): Promise<string[]>;

    /**
     * Get the path to git executable
     * @returns Path to git binary (e.g. from dugite)
     */
    getGitExecutablePath(): Promise<string>;

    /**
     * Get tiddler content at a specific point in time from git history
     * This is used for 3-way merge to get the base version
     * @param wikiFolderPath - Path to the wiki folder
     * @param tiddlerTitle - Title of the tiddler
     * @param beforeDate - Get the version that existed before this date
     * @returns Tiddler fields including text, or null if not found
     */
    getTiddlerAtTime(
      wikiFolderPath: string,
      tiddlerTitle: string,
      beforeDate: Date,
    ): Promise<{ fields: Record<string, unknown>; text: string } | null>;

    /**
     * Get repository path for a workspace
     * @param workspaceId - The workspace ID
     * @returns Repository folder path, or null if workspace not found
     */
    getWorkspaceRepoPath(workspaceId: string): Promise<string | null>;
  }

  /**
   * Workspace service interface for workspace management
   */
  interface IWorkspaceService {
    /**
     * Get workspace token for a given workspace
     * @param workspaceId - The workspace ID
     * @returns The workspace token, or null if not found
     */
    getWorkspaceToken(workspaceId: string): Promise<string | null>;

    /**
     * Validate workspace token for authentication
     * @param workspaceId - The workspace ID
     * @param token - The token to validate
     * @returns true if token is valid for this workspace
     */
    validateWorkspaceToken(workspaceId: string, token: string): Promise<boolean>;
  }

  /**
   * All TidGi services available in the wiki worker context
   */
  interface Services {
    git: IGitService;
    workspace: IWorkspaceService;
  }
}

/**
 * Extend the global namespace to include TidGi services
 */
declare global {
  // eslint-disable-next-line no-var
  var service: TidGiGlobal.Services | undefined;
}

/**
 * TiddlyWiki boot object extended with TidGi-specific properties
 */
export interface TidGiBoot {
  /**
   * Path to the wiki's tiddlers folder
   */
  wikiPath?: string;
  // Add other boot properties as needed
}

export {};
