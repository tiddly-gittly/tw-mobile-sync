/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import { ClientInfoStore } from 'src/tw-mobile-sync/data/clientInfoStoreClass';
import { filterOutNotSyncedTiddlers } from 'src/tw-mobile-sync/data/filterOutNotSyncedTiddlers';
import { mergeTiddler } from 'src/tw-mobile-sync/data/mergeTiddler';
import { getSyncedTiddlersText } from 'src/tw-mobile-sync/getSyncedTiddlersText';
import type { ITiddlerFields, ServerEndpointHandler, Tiddler } from 'tiddlywiki';
import { getServerChangeFilter } from '../../data/filters';
import { getClientInfo } from '../../data/getClientInfo';
import { ConnectionState, ISyncEndPointRequest } from '../../types';

exports.method = 'POST';

// route should start with something https://github.com/Jermolene/TiddlyWiki5/issues/4807
// route is also in src/sync/getEndPoint.ts
exports.path = /^\/tw-mobile-sync\/sync-by-log$/;

// TODO: use this custom endpoint to handle conflict on server side
const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest & Http.InformationEvent, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const data = $tw.utils.parseJSONSafe(context.data) as ISyncEndPointRequest;
    const { lastSync: clientLastSync, deleted: clientDeletedTiddlersTitle = [] } = data;
    let { tiddlers: clientTiddlerFields } = data;
    if (clientLastSync === undefined) {
      response.writeHead(400);
      response.end(`Need to provide lastSync field to calculate diff.`, 'utf8');
      return;
    }
    if (!Array.isArray(clientTiddlerFields)) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(`Bad request body, not a tiddler list. ${String(clientTiddlerFields)}`, 'utf8');
    }
    clientTiddlerFields = filterOutNotSyncedTiddlers(clientTiddlerFields);

    const serverResponse: {
      deletes: string[];
      updates: ITiddlerFields[];
    } = {
      updates: [], // Tiddlers that the client should update or add
      deletes: [], // Tiddler titles that the client should delete
    };

    const processedTiddlerTitles = new Set<string>();

    // Fetch the updated and deleted tiddlers from the server database BEFORE making any changes.
    // get changed tiddlers
    const serverChangedTiddlersFilter: string = getServerChangeFilter(clientLastSync);
    const serverChangedTiddlers: string[] = context.wiki.compileFilter(serverChangedTiddlersFilter)() ?? [];
    const serverUpdatedTiddlerFields = filterOutNotSyncedTiddlers(
      serverChangedTiddlers
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

      const serverTiddler = context.wiki.getTiddler(title);

      if (!serverTiddler) {
        // Tiddler doesn't exist on server, so save client tiddler
        context.wiki.addTiddler(clientTiddlerField);
      } else if (!serverTiddler.fields.modified || !clientTiddlerField.modified) {
        // Some tiddler may not have modified field, for example, add by template or button
        // We can't decide which is new, but we assume mobile-first, so let mobile take preference
        context.wiki.addTiddler(clientTiddlerField);
      } else if (new Date(clientTiddlerField.modified) > serverTiddler.fields.modified) {
        // Client tiddler is newer
        context.wiki.addTiddler(clientTiddlerField);
      } else if (serverTiddler.fields.modified > new Date(clientLastSync)) {
        // Server tiddler is newer and has changed after client's last sync, unfortunately, client change it too.
        // clientTiddler.modified > clientLastSync, we can't decide which is newer, this means both have update, we need to merge them
        const clientTiddler = new $tw.Tiddler(clientTiddlerField);
        const mergedTiddlerFields = mergeTiddler(clientTiddler.fields, serverTiddler.fields);
        serverResponse.updates.push(mergedTiddlerFields);
        context.wiki.addTiddler(mergedTiddlerFields);
      }
      // we should have covered all cases
      console.log(`Unhandled case: ${title}`, clientTiddlerField, serverTiddler?.fields);
    });

    serverUpdatedTiddlerFields.forEach(serverTiddlerField => {
      // Only add if the client hasn't already processed this tiddler in above forEach loop
      if (!processedTiddlerTitles.has(serverTiddlerField.title)) {
        serverResponse.updates.push(serverTiddlerField);
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
    if (clientInfo.Origin !== undefined) {
      clientInfoStore.updateClient(`${clientInfo.Origin ?? ''}${clientInfo['User-Agent'] ?? ''}`, {
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
