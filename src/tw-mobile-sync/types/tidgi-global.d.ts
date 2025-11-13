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
  }

  /**
   * All TidGi services available in the wiki worker context
   */
  interface Services {
    git: IGitService;
    // Add other services as needed
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
