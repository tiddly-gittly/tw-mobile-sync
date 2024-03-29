/* eslint-disable security-node/detect-crlf */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
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
    const serverDeletedTiddlerTitles: string[] = []; // TODO: save server deletion log to use here. getDeletedTiddlersFromDatabase(clientLastSync);

    clientDeletedTiddlersTitle.forEach(deletedTitle => {
      // Tiddler was deleted on the client, even it is edited on server, we delete it because we don't want it on mobile, and mobile-first.
      context.wiki.deleteTiddler(deletedTitle);
      serverResponse.deletes.push(deletedTitle);
    });
    clientTiddlerFields.forEach(clientTiddlerField => {
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
          const mergedTiddlerFields = mergeTiddler(clientTiddler.fields, serverTiddler.fields);
          // make sure `list` and `tags` are tiddlywiki array string, instead of JS array, otherwise core can't read tiddler store. And make sure `created` `modified` are tiddlywiki UTC date string, instead of JS Date object.
          const mergedFieldStrings = new $tw.Tiddler(mergedTiddlerFields).getFieldStrings();
          serverResponse.updates.push(mergedFieldStrings);
          context.wiki.addTiddler(mergedTiddlerFields);
        } else if (new $tw.Tiddler(clientTiddlerField).fields.modified > serverTiddler.fields.modified) {
          // Client tiddler is newer
          context.wiki.addTiddler(clientTiddlerField);
        } else {
          // we should have covered all cases
          console.log(
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `Unhandled case: ${title} \nwhere ${String(new $tw.Tiddler(clientTiddlerField).fields.modified)} > ${serverTiddler?.fields?.modified} is ${
              String(new $tw.Tiddler(clientTiddlerField).fields.modified > (serverTiddler?.fields?.modified ?? 0))
            }`,
            clientTiddlerField,
            serverTiddler?.fields,
          );
          context.wiki.addTiddler(clientTiddlerField);
        }
      } catch (error) {
        console.error('Error when processing tiddler', clientTiddlerField, error);
      }
    });

    console.log(`Before process serverUpdatedTiddlerFields, processedTiddlerTitles ${[...processedTiddlerTitles].join(', ')}`);
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

exports.handler = handler;
