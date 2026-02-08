import type { IContentTypeInfo, ITiddlerFields } from 'tiddlywiki';

interface IDiffMatchPatch {
  diff_match_patch: new() => {
    patch_make: (base: string, text: string) => unknown[];
    patch_apply: (patches: unknown[], text: string) => [string, boolean[]];
  };
}

/**
 * Merge two tiddlers using 3-way merge if base version is provided
 * @param client - Client (mobile) version
 * @param server - Server (desktop) version
 * @param base - Optional base version (from git history at lastSync time)
 * @returns Merged tiddler fields
 * @url https://neil.fraser.name/software/diff_match_patch/demos/patch.html
 */
export function mergeTiddler(
  client: ITiddlerFields,
  server: ITiddlerFields,
  base?: ITiddlerFields | null,
): ITiddlerFields {
  if (client.title !== server.title) {
    throw new Error(`Cannot merge tiddlers with different titles: ${client.title} and ${server.title}`);
  }

  const newerOne = (client.modified && server.modified) ? client.modified > server.modified ? client : server : client;
  const clientIsBinary = isBinaryTiddler(client);
  const serverIsBinary = isBinaryTiddler(server);

  // Handle binary tiddlers - can't merge, just pick one
  if (clientIsBinary || serverIsBinary) {
    if (clientIsBinary && serverIsBinary) {
      return newerOne;
    } else if (clientIsBinary) {
      // we choose binary, because we assume binary data is more important than pure text
      return client;
    } else {
      return server;
    }
  }

  // Both are text tiddlers - try 3-way merge if base is available
  if (base && !isBinaryTiddler(base)) {
    try {
      const mergedText = performThreeWayMerge(
        base.text || '',
        client.text || '',
        server.text || '',
      );

      if (mergedText !== null) {
        // Successful merge - use merged text with fields from newer version
        return {
          ...newerOne,
          text: mergedText,
        };
      }
    } catch (error) {
      console.error('3-way merge failed, falling back to simple merge:', error);
    }
  }

  // Fallback: no base version or merge failed - just use newer version
  return newerOne;
}

/**
 * Perform 3-way merge using diff-match-patch
 * @param base - Common ancestor version
 * @param ours - Client version
 * @param theirs - Server version
 * @returns Merged text, or null if merge failed
 */
function performThreeWayMerge(base: string, ours: string, theirs: string): string | null {
  // If either version is unchanged from base, use the other version
  if (ours === base) {
    return theirs;
  }
  if (theirs === base) {
    return ours;
  }
  if (ours === theirs) {
    return ours;
  }

  try {
    // Load diff-match-patch from TiddlyWiki core using dynamic require
    // This is a TiddlyWiki module path, not a node_modules path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dmp = require('$:/core/modules/utils/diff-match-patch/diff_match_patch.js') as IDiffMatchPatch;
    const dmpInstance = new dmp.diff_match_patch();

    // Create patches from base to ours
    const patchesOurs = dmpInstance.patch_make(base, ours);
    // Create patches from base to theirs
    const patchesTheirs = dmpInstance.patch_make(base, theirs);

    // Apply both sets of patches to base
    // First apply ours patches
    const [text1, results1] = dmpInstance.patch_apply(patchesOurs, base);

    // Then apply theirs patches to the result
    const [mergedText, results2] = dmpInstance.patch_apply(patchesTheirs, text1);

    // Check if all patches applied successfully
    const allSuccess = results1.every((r: boolean) => r) && results2.every((r: boolean) => r);

    if (!allSuccess) {
      console.warn('Some patches failed to apply cleanly during 3-way merge');
      // Still return the result, but mark conflict in the text
      return `<!-- MERGE CONFLICT: Some changes could not be automatically merged -->\n\n${mergedText}`;
    }

    return mergedText;
  } catch (error) {
    console.error('Error during 3-way merge:', error);
    return null;
  }
}

export function isBinaryTiddler(tiddlerFields: ITiddlerFields): boolean {
  const contentType = tiddlerFields.type || 'text/vnd.tiddlywiki';
  // contentTypeInfo is typed as Record<string, IContentTypeInfo> but may be undefined at runtime
  const contentTypeInfo = $tw.config.contentTypeInfo[contentType] as IContentTypeInfo | undefined;
  if (!contentTypeInfo) {
    return false;
  }
  return contentTypeInfo.encoding === 'base64';
}
