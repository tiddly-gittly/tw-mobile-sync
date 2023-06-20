/* eslint-disable unicorn/no-array-callback-reference */
import type { Tiddler, IServerStatus, ITiddlerFieldsParam } from 'tiddlywiki';
import mapValues from 'lodash/mapValues';
import { activeServerStateTiddlerTitle, clientStatusStateTiddlerTitle, getLoopInterval } from './data/constants';
import { getDiffFilter, getServerListFilter } from './data/filters';
import { getClientInfoPoint, getFullHtmlEndPoint, getStatusEndPoint, getSyncEndPoint } from './data/getEndPoint';
import type { ISyncEndPointRequest, IClientInfo } from './types';
import { ConnectionState } from './types';
import cloneDeep from 'lodash/cloneDeep';
import { getSyncedTiddlersText } from './getSyncedTiddlersText';
import { filterOutNotSyncedTiddlers } from './data/filterOutNotSyncedTiddlers';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.name = 'browser-background-sync';
exports.platforms = ['browser'];
// modules listed in https://tiddlywiki.com/dev/#StartupMechanism
// not blocking rendering
exports.after = ['render'];
exports.synchronous = true;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

interface IServerInfoTiddler extends Tiddler {
  fields: Tiddler['fields'] & {
    ipAddress: string;
    /**
     * Last synced time, be undefined if never synced
     */
    lastSync: string | undefined;
    name: string;
    port: number;
    text: ConnectionState;
  };
}

class BackgroundSyncManager {
  loop: ReturnType<typeof setInterval> | undefined;
  loopInterval: number;
  /** lock the sync for `this.syncWithServer`, while last sync is still on progress */
  lock = false;

  constructor() {
    // TODO: get this from setting
    this.loopInterval = getLoopInterval();
    this.setupListener();
    this.startCheckServerStatusLoop();
  }

  setupListener() {
    $tw.rootWidget.addEventListener('tw-mobile-sync-get-server-status', async (event) => await this.getServerStatus());
    $tw.rootWidget.addEventListener('tw-mobile-sync-set-active-server-and-sync', async (event) => {
      const titleToActive = event.paramObject?.title as string | undefined;
      await this.setActiveServerAndSync(titleToActive);
    });
    /** handle events from src/ui/ServerItemViewTemplate.tid 's $:/plugins/linonetwo/tw-mobile-sync/ui/ServerItemViewTemplate */
    $tw.rootWidget.addEventListener('tw-mobile-sync-sync-start', async (event) => await this.start());
    $tw.rootWidget.addEventListener('tw-mobile-sync-download-full-html', async (event) => await this.downloadFullHtmlAndApplyToWiki());
  }

  startCheckServerStatusLoop() {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/promise-function-async
    setInterval(() => this.getServerStatus(), this.loopInterval);
  }

  async start(skipStatusCheck?: boolean) {
    if (this.loop !== undefined) {
      clearInterval(this.loop);
      this.lock = false;
    }
    await this.onSyncStart(skipStatusCheck);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/promise-function-async
    this.loop = setInterval(() => this.onSyncStart(skipStatusCheck), this.loopInterval);
  }

  async onSyncStart(skipStatusCheck?: boolean) {
    void this.getConnectedClientStatus();
    if (this.lock) {
      return;
    }
    this.lock = true;
    try {
      if (skipStatusCheck !== true) {
        await this.getServerStatus();
      }
      await this.syncWithServer();
      // Maybe should add lock to avoid infinite loop, if also sync after autosave. But we don't have sync after autosave yet, so no lock on this is ok.
      $tw.rootWidget.dispatchEvent({ type: 'tm-auto-save-wiki' });
    } finally {
      this.lock = false;
    }
  }

  async setActiveServerAndSync(titleToActive: string | undefined) {
    try {
      if (typeof titleToActive === 'string' && $tw.wiki.getTiddler(titleToActive) !== undefined) {
        // update status first
        await this.getServerStatus();
        // get latest tiddler
        const serverToActive = $tw.wiki.getTiddler<IServerInfoTiddler>(titleToActive);
        if (serverToActive !== undefined) {
          const newStatus = [ConnectionState.onlineActive, ConnectionState.online].includes(serverToActive.fields.text as ConnectionState)
            ? ConnectionState.onlineActive
            : ConnectionState.offlineActive;
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

  /** On TidGi desktop, get connected client info */
  async getConnectedClientStatus() {
    try {
    const response: Record<string, IClientInfo> = await fetch(getClientInfoPoint()).then(
      async (response) => (await response.json()) as Record<string, IClientInfo>,
      );
      Object.values(response).forEach((clientInfo) => {
        $tw.wiki.addTiddler({
          title: `${clientStatusStateTiddlerTitle}/${clientInfo.Origin}`,
          ...clientInfo,
        });
      });
    } catch (error) {
      console.warn(`tw-mobile-sync can't connect to tw nodejs side. Error: ${(error as Error).message}`);
    }
  }

  /** On Tiddloid mobile, get TidGi server status */
  async getServerStatus() {
    const timeout = 3000;
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
                text: active ? ConnectionState.onlineActive : ConnectionState.online,
              },
            };
          }
        } catch (error) {
          if ((error as Error).message.includes('The operation was aborted')) {
            $tw.wiki.addTiddler({
              title: '$:/state/notification/tw-mobile-sync/notification',
              text: `GetServerStatus Timeout after ${timeout / 1000}s`,
            });
          } else {
            console.error(`getServerStatus() ${(error as Error).message} ${serverInfoTiddler.fields.name} ${(error as Error).stack ?? ''}`);
            $tw.wiki.addTiddler({
              title: '$:/state/notification/tw-mobile-sync/notification',
              text: `GetServerStatus Failed ${(error as Error).message}`,
            });
          }
        }
        $tw.notifier.display('$:/state/notification/tw-mobile-sync/notification');
        return {
          ...serverInfoTiddler,
          fields: {
            ...serverInfoTiddler.fields,
            text: active ? ConnectionState.offlineActive : ConnectionState.offline,
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
      // fix multiple online active server
      this.serverList.forEach((serverInfoTiddler) => {
        if (serverInfoTiddler?.fields?.text === ConnectionState.onlineActive && serverInfoTiddler?.fields?.title !== onlineActiveServer.fields.title) {
          $tw.wiki.addTiddler({ ...serverInfoTiddler.fields, text: ConnectionState.online });
        }
      });
      try {
        const changedTiddlersFromClient = filterOutNotSyncedTiddlers(this.currentModifiedTiddlers);

        const requestBody: ISyncEndPointRequest = { tiddlers: changedTiddlersFromClient, lastSync: onlineActiveServer.fields.lastSync };
        // TODO: handle conflict, find intersection of changedTiddlersFromServer and changedTiddlersFromClient, and write changes to each other
        // send modified tiddlers to server
        const changedTiddlersFromServer: ITiddlerFieldsParam[] = await fetch(
          getSyncEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port),
          {
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify(requestBody),
            headers: {
              'X-Requested-With': 'TiddlyWiki',
              'Content-Type': 'application/json',
            },
            // TODO: add auth token in header, after we can scan QR code to get token easily
          },
        ).then(async (response) => filterOutNotSyncedTiddlers((await response.json()) as ITiddlerFieldsParam[]));
        changedTiddlersFromServer.forEach((tiddler) => {
          // TODO: handle conflict
          $tw.wiki.addTiddler(tiddler);
        });

        $tw.wiki.addTiddler({
          title: '$:/state/notification/tw-mobile-sync/notification',
          text: `Sync Complete ${getSyncedTiddlersText(changedTiddlersFromClient, changedTiddlersFromServer)}`,
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
            'Content-Type': 'text/html',
          },
        }).then(async (response) => await response.text());
        this.setActiveServerTiddlerTitle(onlineActiveServer.fields.title, this.getLastSyncString());
        // get all state tiddlers we need, before document is overwritten
        const serverList = cloneDeep(this.serverList);
        // overwrite
        document.write(fullHtml);
        document.close();
        this.#showNotification(`Full html applied, set server list back.`);

        // write back after html stabled
        addEventListener('DOMContentLoaded', (event) => {
          setTimeout(() => {
            $tw.wiki.addTiddlers(serverList.map((tiddler) => tiddler.fields));
          }, 1000);
        });
      } catch (error) {
        console.error(error);
        this.#showNotification(`Full html apply failed ${(error as Error).message}`);
      }
    }
  }

  get onlineActiveServer() {
    return this.serverList.find((serverInfoTiddler) => {
      return serverInfoTiddler?.fields?.text === ConnectionState.onlineActive;
    });
  }

  /**
   *  update last sync using <<now "[UTC]YYYY0MM0DD0hh0mm0ssXXX">>
   */
  getLastSyncString() {
    return $tw.utils.stringifyDate(new Date());
  }

  get currentModifiedTiddlers(): ITiddlerFieldsParam[] {
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
      .map(
        (tiddler): ITiddlerFieldsParam =>
          mapValues(tiddler.fields, (value) => {
            if (value instanceof Date) {
              return $tw.utils.stringifyDate(value);
            }
            return value as string;
          }),
      );
  }

  get serverList() {
    // get server list using filter
    const serverList: string[] = $tw.wiki.compileFilter(getServerListFilter())() ?? [];
    return serverList.map((serverInfoTiddlerTitle) => {
      return $tw.wiki.getTiddler(serverInfoTiddlerTitle) as IServerInfoTiddler;
    });
  }

  #showNotification(text: string) {
    $tw.wiki.addTiddler({
      title: '$:/state/notification/tw-mobile-sync/notification',
      text,
    });
    $tw.notifier.display('$:/state/notification/tw-mobile-sync/notification');
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = () => {
  const syncManager = new BackgroundSyncManager();
  void syncManager.start();
};
