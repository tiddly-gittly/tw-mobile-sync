/**
 * Type definitions for TidGi Desktop services exposed to TiddlyWiki plugins
 * These types match the services available in TidGi-Desktop's wiki worker
 */

/**
 * A chunk of Git Smart HTTP response transported via IPC Observable.
 * First emission carries headers, subsequent ones carry data.
 */
export type GitHTTPResponseChunk =
  | { type: 'headers'; statusCode: number; headers: Record<string, string> }
  | { type: 'data'; data: Uint8Array };

/**
 * Minimal Observable interface (subset of rxjs Observable used through IPC proxy).
 * The real implementation comes from electron-ipc-cat's Function$ proxy.
 */
export interface IObservable<T> {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (error: Error) => void;
    complete?: () => void;
  }): { unsubscribe: () => void };
}

/**
 * Git Smart HTTP Server Service
 * Provides Git Smart HTTP endpoints for mobile clients
 */
export interface IGitServerService {
  /**
   * Get repository path for a workspace
   */
  getWorkspaceRepoPath(workspaceId: string): Promise<string | undefined>;

  /**
   * Git Smart HTTP info/refs — returns IPC Observable streaming response chunks.
   */
  gitSmartHTTPInfoRefs$(workspaceId: string, service: string): IObservable<GitHTTPResponseChunk>;

  /**
   * Git Smart HTTP upload-pack (fetch/pull).
   * @param requestBody collected POST body (Uint8Array is structured-clone safe)
   */
  gitSmartHTTPUploadPack$(workspaceId: string, requestBody: Uint8Array): IObservable<GitHTTPResponseChunk>;

  /**
   * Git Smart HTTP receive-pack (push).
   * @param requestBody collected POST body
   */
  gitSmartHTTPReceivePack$(workspaceId: string, requestBody: Uint8Array): IObservable<GitHTTPResponseChunk>;
}

/**
 * Git service interface for version control operations
 */
export interface IGitService {
  /**
   * Get deleted tiddler titles from git history since a specific date
   */
  getDeletedTiddlersSinceDate(wikiFolderPath: string, sinceDate: Date): Promise<string[]>;

  /**
   * Get tiddler content at a specific point in time from git history
   */
  getTiddlerAtTime(
    wikiFolderPath: string,
    tiddlerTitle: string,
    beforeDate: Date,
  ): Promise<{ fields: Record<string, unknown>; text: string } | null>;
}

/**
 * Workspace service interface for workspace management
 */
export interface IWorkspaceService {
  /**
   * Get workspace token for a given workspace
   * @param workspaceId - The workspace ID
   * @returns The workspace token, or undefined if not found
   */
  getWorkspaceToken(workspaceId: string): Promise<string | undefined>;

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
export interface ITidGiGlobalService {
  git: IGitService;
  gitServer?: IGitServerService;
  workspace: IWorkspaceService;
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
