/**
 * Type definitions for TidGi Desktop services exposed to TiddlyWiki plugins
 * These types match the services available in TidGi-Desktop's wiki worker
 */

import type { IncomingMessage as NodeIncomingMessage, ServerResponse as NodeServerResponse } from 'http';

/**
 * Git service interface for version control operations
 */
export interface IGitService {
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
   * @returns Repository folder path, or undefined if workspace not found
   */
  getWorkspaceRepoPath(workspaceId: string): Promise<string | undefined>;

  /**
   * Handle Git Smart HTTP info/refs endpoint
   * @param workspaceId workspace ID
   * @param service 'git-upload-pack' | 'git-receive-pack'
   * @param request Node.js HTTP request
   * @param response Node.js HTTP response
   */
  handleInfoRefs(workspaceId: string, service: string, request: NodeIncomingMessage, response: NodeServerResponse): Promise<void>;

  /**
   * Handle Git Smart HTTP upload-pack endpoint (git fetch/pull)
   * @param workspaceId workspace ID
   * @param request Node.js HTTP request (stream)
   * @param response Node.js HTTP response (stream)
   */
  handleUploadPack(workspaceId: string, request: NodeIncomingMessage, response: NodeServerResponse): Promise<void>;

  /**
   * Handle Git Smart HTTP receive-pack endpoint (git push)
   * @param workspaceId workspace ID
   * @param request Node.js HTTP request (stream)
   * @param response Node.js HTTP response (stream)
   */
  handleReceivePack(workspaceId: string, request: NodeIncomingMessage, response: NodeServerResponse): Promise<void>;
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
