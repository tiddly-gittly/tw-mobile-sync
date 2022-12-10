/* eslint-disable unicorn/no-array-callback-reference */
import type { Tiddler, IServerStatus, ITiddlerFields } from 'tiddlywiki';
import mapValues from 'lodash/mapValues';
import { activeServerStateTiddlerTitle, twDefaultDateTimeFormat } from './constants';
import { getDiffFilter, serverListFilter } from './filters';
import { getFullHtmlEndPoint, getStatusEndPoint, getSyncEndPoint } from './sync/getEndPoint';
import { ISyncEndPointRequest } from './types';
import cloneDeep from 'lodash/cloneDeep';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.name = 'browser-background-sync';
exports.platforms = ['browser'];
// modules listed in https://tiddlywiki.com/dev/#StartupMechanism
// not blocking rendering
exports.after = ['render'];
exports.synchronous = true;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

enum ServerState {
  offline = 'offline',
  /** once selected by the user, but now offlined */
  offlineActive = 'offlineActive',
  /** online and not selected by the user */
  online = 'online',
  /** online and selected by the user */
  onlineActive = 'onlineActive',
}

interface IServerInfoTiddler extends Tiddler {
  fields: Tiddler['fields'] & {
    ipAddress: string;
    /**
     * Last synced time, be undefined if never synced
     */
    lastSync: string | undefined;
    name: string;
    port: number;
    text: ServerState;
  };
}

class BackgroundSyncManager {
  loop: ReturnType<typeof setInterval> | undefined;
  loopInterval = 1000 * 60 * 5; // 5 minutes
  /** lock the sync for `this.syncWithServer`, while last sync is still on progress */
  lock = false;

  constructor() {
    // TODO: get this from setting
    this.loopInterval = 1000 * 60 * 5; // 5 minutes
    this.setupListener();
  }

  setupListener() {
    $tw.rootWidget.addEventListener('tw-mobile-sync-get-server-status', async (event) => await this.getServerStatus());
    $tw.rootWidget.addEventListener('tw-mobile-sync-set-active-server-and-sync', async (event) => {
      const titleToActive = event.paramObject?.title as string | undefined;
      await this.setActiveServerAndSync(titleToActive);
    });
    $tw.rootWidget.addEventListener('tw-mobile-sync-sync-start', async (event) => await this.start());
    $tw.rootWidget.addEventListener('tw-mobile-sync-download-full-html', async (event) => await this.downloadFullHtmlAndApplyToWiki());
  }

  async start(skipStatusCheck?: boolean) {
    if (this.loop !== undefined) {
      clearInterval(this.loop);
      this.lock = false;
    }
    const loopHandler = async () => {
      if (this.lock) {
        return;
      }
      this.lock = true;
      try {
        if (skipStatusCheck !== true) {
          await this.getServerStatus();
        }
        await this.syncWithServer();
      } finally {
        this.lock = false;
      }
    };
    await loopHandler();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.loop = setInterval(loopHandler, this.loopInterval);
  }

  async setActiveServerAndSync(titleToActive: string | undefined) {
    try {
      if (typeof titleToActive === 'string' && $tw.wiki.getTiddler(titleToActive) !== undefined) {
        // update status first
        await this.getServerStatus();
        // get latest tiddler
        const serverToActive = $tw.wiki.getTiddler<IServerInfoTiddler>(titleToActive);
        if (serverToActive !== undefined) {
          const newStatus = [ServerState.onlineActive, ServerState.online].includes(serverToActive.fields.text as ServerState)
            ? ServerState.onlineActive
            : ServerState.offlineActive;
          $tw.wiki.addTiddler({ ...serverToActive.fields, text: newStatus });
          this.setActiveServerTiddlerTitle(titleToActive, serverToActive.fields.lastSync);
          await this.start(true);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  getActiveServerTiddlerTitle() {
    return $tw.wiki.getTiddlerText(activeServerStateTiddlerTitle);
  }

  setActiveServerTiddlerTitle(title: string, lastSync: string | undefined) {
    // update active server record in `activeServerStateTiddlerTitle`, this is a pointer tiddler point to actual server tiddler
    $tw.wiki.addTiddler({ title: activeServerStateTiddlerTitle, text: title, lastSync });
    // update server's last sync
    const serverToActive = $tw.wiki.getTiddler(title);
    if (serverToActive !== undefined) {
      $tw.wiki.addTiddler({ ...serverToActive.fields, lastSync });
    }
  }

  async getServerStatus() {
    const timeout = 1000;
    const activeTiddlerTitle = this.getActiveServerTiddlerTitle();
    const serverListWithUpdatedStatus = await Promise.all(
      this.serverList.map(async (serverInfoTiddler) => {
        const active = serverInfoTiddler.fields.title === activeTiddlerTitle;
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeout);
          const response: IServerStatus = await fetch(getStatusEndPoint(serverInfoTiddler.fields.ipAddress, serverInfoTiddler.fields.port), {
            signal: controller.signal,
          }).then(async (response) => (await response.json()) as IServerStatus);
          clearTimeout(id);
          if (typeof response.tiddlywiki_version === 'string') {
            return {
              ...serverInfoTiddler,
              fields: {
                ...serverInfoTiddler.fields,
                text: active ? ServerState.onlineActive : ServerState.online,
              },
            };
          }
        } catch (error) {
          console.error(`${(error as Error).message} ${serverInfoTiddler.fields.name}`);
        }
        return {
          ...serverInfoTiddler,
          fields: {
            ...serverInfoTiddler.fields,
            text: active ? ServerState.offlineActive : ServerState.offline,
          },
        };
      }),
    );
    serverListWithUpdatedStatus.forEach((tiddler) => {
      $tw.wiki.addTiddler(tiddler.fields);
    });
  }

  async syncWithServer() {
    const onlineActiveServer = this.onlineActiveServer;

    if (onlineActiveServer !== undefined) {
      try {
        const changedTiddlersFromClient = this.currentModifiedTiddlers;
        const requestBody: ISyncEndPointRequest = { tiddlers: changedTiddlersFromClient, lastSync: onlineActiveServer.fields.lastSync };
        // TODO: handle conflict, find intersection of changedTiddlersFromServer and changedTiddlersFromClient, and write changes to each other
        // send modified tiddlers to server
        const changedTiddlersFromServer: Tiddler[] = await fetch(getSyncEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port), {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify(requestBody),
          headers: {
            'X-Requested-With': 'TiddlyWiki',
            'Content-Type': 'application/json',
          },
          // TODO: add auth token in header, after we can scan QR code to get token easily
        }).then(async (response) => (await response.json()) as Tiddler[]);
        changedTiddlersFromServer.forEach((tiddler) => {
          // TODO: handle conflict
          $tw.wiki.addTiddler(tiddler);
        });
        $tw.wiki.addTiddler({
          title: '$:/state/notification/tw-mobile-sync/notification',
          text: `Sync Complete ↑ ${changedTiddlersFromClient.length} ↓ ${changedTiddlersFromServer.length}`,
        });
        this.setActiveServerTiddlerTitle(onlineActiveServer.fields.title, this.getLastSyncString());
      } catch (error) {
        console.error(error);
        $tw.wiki.addTiddler({
          title: '$:/state/notification/tw-mobile-sync/notification',
          text: `Sync Failed ${(error as Error).message}`,
        });
      }
      $tw.notifier.display('$:/state/notification/tw-mobile-sync/notification');
    }
  }

  async downloadFullHtmlAndApplyToWiki() {
    const onlineActiveServer = this.onlineActiveServer;

    if (onlineActiveServer !== undefined) {
      try {
        const fullHtml = await fetch(getFullHtmlEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port), {
          mode: 'cors',
          headers: {
            'X-Requested-With': 'TiddlyWiki',
            'Content-Type': 'application/json',
          },
        }).then(async (response) => await response.text());
        this.setActiveServerTiddlerTitle(onlineActiveServer.fields.title, this.getLastSyncString());
        // get all state tiddlers we need, before document is overwritten
        const serverList = cloneDeep(this.serverList);

        // overwrite
        document.write(fullHtml);
        document.close();

        // write back
        $tw.wiki.addTiddlers(serverList.map((tiddler) => tiddler.fields));
      } catch (error) {
        console.error(error);
      }
    }
  }

  get onlineActiveServer() {
    return this.serverList.find((serverInfoTiddler) => {
      // TODO: compile to lower es for browser support
      return serverInfoTiddler?.fields?.text === ServerState.onlineActive;
    });
  }

  /**
   *  update last sync using <<now "[UTC]YYYY0MM0DD0hh0mm0ssXXX">>
   */
  getLastSyncString() {
    return $tw.utils.stringifyDate(new Date());
  }

  get currentModifiedTiddlers(): ITiddlerFields[] {
    const onlineActiveServer = this.onlineActiveServer;

    if (onlineActiveServer === undefined) {
      return [];
    }
    const lastSync = onlineActiveServer.fields.lastSync;
    const diffTiddlersFilter: string = getDiffFilter(lastSync);
    const diffTiddlers: string[] = $tw.wiki.compileFilter(diffTiddlersFilter)() ?? [];
    return diffTiddlers
      .map($tw.wiki.getTiddler)
      .filter((tiddler): tiddler is Tiddler => tiddler !== undefined)
      .map((tiddler) =>
        mapValues(tiddler.fields, (value) => {
          if (value instanceof Date) {
            return $tw.utils.stringifyDate(value);
          }
          return value;
        }),
      );
  }

  get serverList() {
    // get server list using filter
    const serverList: string[] = $tw.wiki.compileFilter(serverListFilter)() ?? [];
    return serverList.map((serverInfoTiddlerTitle) => {
      return $tw.wiki.getTiddler(serverInfoTiddlerTitle) as IServerInfoTiddler;
    });
  }
}

exports.startup = () => {
  const syncManager = new BackgroundSyncManager();
  syncManager.start();
};
