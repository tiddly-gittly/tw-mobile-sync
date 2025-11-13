/* eslint-disable security-node/detect-crlf */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ITiddlerFields } from 'tiddlywiki';
import type { TidGiBoot } from '../../types/tidgi-global';
import { ClientInfoStore } from 'src/tw-mobile-sync/data/clientInfoStoreClass';
import { filterOutNotSyncedTiddlers } from 'src/tw-mobile-sync/data/filterOutNotSyncedTiddlers';
import { mergeTiddler } from 'src/tw-mobile-sync/data/mergeTiddler';
import { toTWUTCString } from 'src/tw-mobile-sync/data/toTWUTCString';
import { getSyncedTiddlersText } from 'src/tw-mobile-sync/getSyncedTiddlersText';
import type { ServerEndpointHandler, Tiddler } from 'tiddlywiki';
import { getServerChangeFilter } from '../../data/filters';
import { getClientInfo } from '../../data/getClientInfo';
import { ConnectionState, ISyncEndPointRequest, ISyncEndPointResponse } from '../../types';

exports.method = 'POST';

/**
 * route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
 * route is also in src/sync/getEndPoint.ts
 * This is the V1 of TidGi-Mobile sync endpoint
 *
 * Used in TidGi-Mobile's src/services/BackgroundSyncService/index.ts
 */
exports.path = /^\/tw-mobile-sync\/sync$/;

// TODO: use this custom endpoint to handle conflict on server side
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest & Http.InformationEvent, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  /**
   * TidGi allow user to set read-only mode for server, and set this info tiddler for here to use to prevent user sync back to server.
   */
  const readOnlyMode = context.wiki.getTiddlerText('$:/info/tidgi/readOnlyMode') === 'yes';
  if (readOnlyMode) {
    response.writeHead(401);
    response.end(`Don't sync back to readonly server.`, 'utf8');
    return;
  }

  const handleSync = async () => {
    try {
      const data = $tw.utils.parseJSONSafe(context.data) as ISyncEndPointRequest;
      let { tiddlers: clientTiddlerFields } = data;
      const { deleted: clientDeletedTiddlersTitle = [], lastSync: clientLastSyncJSDateNow } = data;
      if (!clientLastSyncJSDateNow) {
        response.writeHead(400);
        response.end(`Need to provide lastSync field to calculate diff.`, 'utf8');
        return;
      }
      if (!Array.isArray(clientTiddlerFields)) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(`Bad request body, not a tiddler list. ${String(clientTiddlerFields)}`, 'utf8');
        return;
      }
      const clientLastSyncDate = new Date(clientLastSyncJSDateNow);
      console.log(`clientLastSyncJSDateNow ${clientLastSyncJSDateNow} clientLastSyncDate ${String(clientLastSyncDate)} `);
      const clientLastSyncTWUTCString = toTWUTCString(clientLastSyncDate);
      clientTiddlerFields = filterOutNotSyncedTiddlers(clientTiddlerFields);

      const serverResponse: ISyncEndPointResponse = {
        updates: [], // Tiddlers that the client should update or add
        deletes: [], // Tiddler titles that the client should delete
      };

      const processedTiddlerTitles = new Set<string>();

      // Fetch the updated and deleted tiddlers from the server database BEFORE making any changes.
      // get changed tiddlers
      const serverChangedTiddlersFilter: string = getServerChangeFilter(clientLastSyncTWUTCString);
      const serverChangedTiddlerTitles: string[] = context.wiki.compileFilter(serverChangedTiddlersFilter)() ?? [];
      console.log(`serverChangedTiddlersFilter: ${serverChangedTiddlersFilter} serverChangedTiddlers: [${serverChangedTiddlerTitles.join(', ')}]`);
      const serverUpdatedTiddlerFields = filterOutNotSyncedTiddlers(
        serverChangedTiddlerTitles
          .map((title) => {
            return context.wiki.getTiddler(title);
          })
          .filter((index): index is Tiddler => index !== undefined)
          .map((tiddler) => tiddler.fields),
      );

      // Get deleted tiddlers from git history using the git service
      let serverDeletedTiddlerTitles: string[] = [];
      const boot = context.boot as TidGiBoot | undefined;
      if (boot?.wikiPath && typeof global !== 'undefined' && global.service?.git?.getDeletedTiddlersSinceDate) {
        try {
          // Use the git service exposed via global.service
          serverDeletedTiddlerTitles = await global.service.git.getDeletedTiddlersSinceDate(boot.wikiPath, clientLastSyncDate);
          console.log(`Found ${serverDeletedTiddlerTitles.length} deleted tiddlers from git: [${serverDeletedTiddlerTitles.join(', ')}]`);
        } catch (error) {
          console.error(`Failed to get deleted tiddlers from git: ${(error as Error).message}`);
        }
      } else {
        if (!boot?.wikiPath) {
          console.warn('context.boot.wikiPath is undefined, cannot get deleted tiddlers from git');
        } else {
          console.warn('global.service.git.getDeletedTiddlersSinceDate is not available, cannot get deleted tiddlers from git');
        }
      }

      clientDeletedTiddlersTitle.forEach(deletedTitle => {
        // Tiddler was deleted on the client, even it is edited on server, we delete it because we don't want it on mobile, and mobile-first.
        context.wiki.deleteTiddler(deletedTitle);
        serverResponse.deletes.push(deletedTitle);
      });

      // Pre-fetch base versions for all tiddlers that need 3-way merge
      // This is more efficient than fetching them one by one in the loop
      const baseTiddlerCache = new Map<string, ITiddlerFields | null>();
      const tiddlersNeedingMerge: string[] = [];

      // Identify which tiddlers need merge
      for (const clientTiddlerField of clientTiddlerFields) {
        const title = clientTiddlerField.title as string;
        const serverTiddler = context.wiki.getTiddler(title);

        // Check if this tiddler needs 3-way merge
        if (serverTiddler &&
            serverTiddler.fields.modified &&
            clientTiddlerField.modified &&
            serverTiddler.fields.modified > clientLastSyncDate) {
          tiddlersNeedingMerge.push(title);
        }
      }

      // Batch fetch base versions in parallel with timeout protection
      if (tiddlersNeedingMerge.length > 0 &&
          boot?.wikiPath &&
          typeof global !== 'undefined' &&
          global.service?.git?.getTiddlerAtTime) {
        console.log(`Pre-fetching base versions for ${tiddlersNeedingMerge.length} tiddlers that need 3-way merge`);

        const fetchPromises = tiddlersNeedingMerge.map(async (title) => {
          try {
            // Add timeout protection (5 seconds per tiddler)
            const timeoutPromise = new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), 5000);
            });

            // Non-null assertions are safe here because we checked in the if condition
            const fetchPromise = global.service!.git.getTiddlerAtTime(
              boot.wikiPath!,
              title,
              clientLastSyncDate,
            );

            const baseVersion = await Promise.race([fetchPromise, timeoutPromise]);

            if (baseVersion) {
              return {
                title,
                base: {
                  ...baseVersion.fields,
                  text: baseVersion.text,
                } as ITiddlerFields,
              };
            }
            return { title, base: null };
          } catch (error) {
            console.warn(`Failed to get base version for "${title}":`, (error as Error).message);
            return { title, base: null };
          }
        });

        try {
          const results = await Promise.all(fetchPromises);
          results.forEach(({ title, base }) => {
            baseTiddlerCache.set(title, base);
          });

          const successCount = results.filter(r => r.base !== null).length;
          console.log(`Successfully fetched ${successCount}/${tiddlersNeedingMerge.length} base versions for 3-way merge`);
        } catch (error) {
          console.error(`Error during batch fetch of base versions: ${(error as Error).message}`);
        }
      }

      // Process client tiddlers - use for...of to support async operations
      for (const clientTiddlerField of clientTiddlerFields) {
        const title = clientTiddlerField.title as string;
        processedTiddlerTitles.add(title);

        try {
          const serverTiddler = context.wiki.getTiddler(title);

          if (!serverTiddler) {
            // Tiddler doesn't exist on server, so save client tiddler
            context.wiki.addTiddler(clientTiddlerField);
          } else if (!serverTiddler.fields.modified || !clientTiddlerField.modified) {
            // Some tiddler may not have modified field, for example, add by template or button
            // We can't decide which is new, but we assume mobile-first, so let mobile take preference
            context.wiki.addTiddler(clientTiddlerField);
          } else if (serverTiddler.fields.modified > clientLastSyncDate) {
            // Server tiddler is newer and has changed after client's last sync, unfortunately, client change it too.
            // clientTiddler.modified > clientLastSync, we can't decide which is newer, this means both have update, we need to merge them
            const clientTiddler = new $tw.Tiddler(clientTiddlerField);

            // Get base version from pre-fetched cache
            const baseTiddler = baseTiddlerCache.get(title) ?? null;
            if (baseTiddler) {
              console.log(`Using cached base version for 3-way merge of "${title}"`);
            }

            const mergedTiddlerFields = mergeTiddler(clientTiddler.fields, serverTiddler.fields, baseTiddler);
            // make sure `list` and `tags` are tiddlywiki array string, instead of JS array, otherwise core can't read tiddler store. And make sure `created` `modified` are tiddlywiki UTC date string, instead of JS Date object.
            const mergedFieldStrings = new $tw.Tiddler(mergedTiddlerFields).getFieldStrings();
            serverResponse.updates.push(mergedFieldStrings);
            context.wiki.addTiddler(mergedTiddlerFields);
          } else if (new $tw.Tiddler(clientTiddlerField).fields.modified > serverTiddler!.fields.modified) {
            // Client tiddler is newer
            context.wiki.addTiddler(clientTiddlerField);
          } else {
            // we should have covered all cases
            console.log(
              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
              `Unhandled case: ${title} \nwhere ${String(new $tw.Tiddler(clientTiddlerField).fields.modified)} > ${serverTiddler?.fields?.modified} is ${
                String(new $tw.Tiddler(clientTiddlerField).fields.modified > (serverTiddler!.fields.modified ?? 0))
              }`,
              clientTiddlerField,
              serverTiddler?.fields,
            );
            context.wiki.addTiddler(clientTiddlerField);
          }
        } catch (error) {
          console.error('Error when processing tiddler', clientTiddlerField, error);
        }
      }

      const processedTitlesArray = Array.from(processedTiddlerTitles);
      console.log(`Before process serverUpdatedTiddlerFields, processedTiddlerTitles ${processedTitlesArray.join(', ')}`);
      serverUpdatedTiddlerFields.forEach(serverTiddlerField => {
        // Only add if the client hasn't already processed this tiddler in above forEach loop
        if (!processedTiddlerTitles.has(serverTiddlerField.title)) {
          // make sure `list` and `tags` are tiddlywiki array string, instead of JS array, otherwise core can't read tiddler store. And make sure `created` `modified` are tiddlywiki UTC date string, instead of JS Date object.
          const serverTiddlerFieldStrings = new $tw.Tiddler(serverTiddlerField).getFieldStrings();
          serverResponse.updates.push(serverTiddlerFieldStrings);
        }
      });

      serverDeletedTiddlerTitles.forEach(deletedTitle => {
        if (!processedTiddlerTitles.has(deletedTitle)) {
          serverResponse.deletes.push(deletedTitle);
        }
      });

      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(serverResponse), 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const clientInfoStore: ClientInfoStore = require('$:/plugins/linonetwo/tw-mobile-sync/clientInfoStore.js').store;
      const clientInfo = getClientInfo(request, ConnectionState.onlineActive);
      if (clientInfo['User-Agent'] !== undefined) {
        clientInfoStore.updateClient(clientInfo['User-Agent'], {
          ...clientInfo,
          recentlySyncedString: getSyncedTiddlersText(clientTiddlerFields, serverUpdatedTiddlerFields, { client: clientDeletedTiddlersTitle, server: serverDeletedTiddlerTitles }, {
            reverse: true,
          }),
        });
      }
    } catch (error) {
      response.writeHead(500);
      response.end(`Failed to add tiddlers ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
    }
  };

  // Handle async errors with proper promise rejection handling
  handleSync().catch((error) => {
    console.error('Unhandled error in sync handler:', error);
    // Only send response if not already sent
    if (!response.headersSent) {
      response.writeHead(500);
      response.end(`Internal server error: ${(error as Error).message}`, 'utf8');
    }
  });
};

exports.handler = handler;
