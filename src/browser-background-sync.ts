import type { Widget as IWidget, Tiddler, IServerStatus, ITiddlerFields } from 'tiddlywiki';
import { activeServerStateTiddlerTitle } from './constants';
import { getFilterServerEndPoint, getStatusEndPoint, getSyncEndPoint } from './sync/getEndPoint';

exports.name = 'browser-background-sync';
exports.platforms = ['browser'];
// modules listed in https://tiddlywiki.com/dev/#StartupMechanism
// not blocking rendering
exports.after = ['render'];
exports.synchronous = true;

enum ServerState {
  /** online and selected by the user */
  onlineActive = 'onlineActive',
  /** online and not selected by the user */
  online = 'online',
  /** once selected by the user, but now offlined */
  offlineActive = 'offlineActive',
  offline = 'offline',
}

interface IServerInfoTiddler extends Tiddler {
  fields: Tiddler['fields'] & {
    text: ServerState;
    name: string;
    ipAddress: string;
    port: number;
    /**
     * Last synced time, be undefined if never synced
     */
    lastSync: string | undefined;
  };
}

class BackgroundSyncManager {
  loop: ReturnType<typeof setInterval> | undefined;
  loopInterval = 1000 * 60 * 5; // 5 minutes
  /** lock the sync for `this.syncWithServer`, while last sync is still on progress */
  lock: boolean = false;

  constructor() {
    // TODO: get this from setting
    this.loopInterval = 1000 * 60 * 5; // 5 minutes
    this.setupListener();
  }

  setupListener() {
    $tw.rootWidget.addEventListener('tw-mobile-sync-get-server-status', (event) => this.getServerStatus());
    $tw.rootWidget.addEventListener('tw-mobile-sync-set-active-server-and-sync', async (event) => {
      const titleToActive = event.paramObject?.title as string | undefined;
      await this.setActiveServerAndSync(titleToActive);
    });
    $tw.rootWidget.addEventListener('tw-mobile-sync-sync-start', (event) => this.start());
  }

  async start(skipStatusCheck?: boolean) {
    if (this.loop) {
      clearInterval(this.loop);
    }
    const loopHandler = async () => {
      if (this.lock) {
        return;
      }
      this.lock = true;
      try {
        if (skipStatusCheck === true) {
          await this.getServerStatus();
        }
        await this.syncWithServer();
      } finally {
        this.lock = false;
      }
    };
    await loopHandler();
    this.loop = setInterval(loopHandler, this.loopInterval);
  }

  async setActiveServerAndSync(titleToActive: string | undefined) {
    if (typeof titleToActive === 'string') {
      if ($tw.wiki.getTiddler(titleToActive) !== undefined) {
        // update status first
        await this.getServerStatus();
        // get latest tiddler
        const serverToActive = $tw.wiki.getTiddler(titleToActive);
        if (serverToActive !== undefined) {
          const newStatus = [ServerState.onlineActive, ServerState.online].includes(serverToActive.fields.text as ServerState)
            ? ServerState.onlineActive
            : ServerState.offlineActive;
          $tw.wiki.addTiddler({ ...serverToActive.fields, text: newStatus });
          this.setActiveServerTiddlerTitle(titleToActive);
          await this.start(true);
        }
      }
    }
  }

  getActiveServerTiddlerTitle() {
    return $tw.wiki.getTiddlerText(activeServerStateTiddlerTitle);
  }

  setActiveServerTiddlerTitle(title: string) {
    $tw.wiki.addTiddler({ title: activeServerStateTiddlerTitle, text: title });
  }

  async getServerStatus() {
    const activeTiddlerTitle = this.getActiveServerTiddlerTitle();
    const serverListWithUpdatedStatus = await Promise.all(
      this.serverList.map(async (serverInfoTiddler) => {
        const active = serverInfoTiddler.fields.title === activeTiddlerTitle;
        try {
          const response: IServerStatus = await fetch(getStatusEndPoint(serverInfoTiddler.fields.ipAddress, serverInfoTiddler.fields.port)).then((response) =>
            response.json(),
          );
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
      const changedTiddlersFromServer: Tiddler[] = await fetch(
        getFilterServerEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port, this.getDiffFilter(onlineActiveServer.fields.lastSync)),
      ).then((response) => response.json());
      const changedTiddlersFromClient = this.currentModifiedTiddlers.map((tiddler) => tiddler.fields);
      // TODO: handle conflict, find intersection of changedTiddlersFromServer and changedTiddlersFromClient, and write changes to each other
      // send modified tiddlers to server
      await fetch(getSyncEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port), {
        method: 'POST',
        body: JSON.stringify(changedTiddlersFromClient),
        // TODO: add auth token in header, after we can scan QR code to get token easily
      }).then((response) => response.json());
      changedTiddlersFromServer.forEach((tiddler) => {
        // TODO: handle conflict
        $tw.wiki.addTiddler(tiddler);
      });
      onlineActiveServer.fields.lastSync = this.getLastSyncString();
    }
  }

  get onlineActiveServer() {
    return this.serverList.find((serverInfoTiddler) => {
      return serverInfoTiddler?.fields?.text === ServerState.onlineActive;
    });
  }

  /**
   *  update last sync using <<now "[UTC]YYYY0MM0DD0hh0mm0ssXXX">>
   */
  getLastSyncString() {
    return $tw.utils.formatDateString(new Date(), '[UTC]YYYY0MM0DD0hh0mm0ssXXX');
  }

  getDiffFilter(lastSync: string | undefined) {
    return `[all[]!is[system]] :filter[get[modified]compare:date:gt[${lastSync ?? ''}]]`;
  }

  get currentModifiedTiddlers() {
    const onlineActiveServer = this.onlineActiveServer;

    if (onlineActiveServer === undefined) {
      return [];
    }
    const lastSync = onlineActiveServer.fields.lastSync;
    const diffTiddlersFilter: string = this.getDiffFilter(lastSync);
    const diffTiddlers: string[] = $tw.wiki.compileFilter(diffTiddlersFilter)() ?? [];
    return diffTiddlers.map((title) => {
      return $tw.wiki.getTiddler(title)!;
    });
  }

  get serverList() {
    // get server list using filter
    const serverListFilter: string = `[prefix[$:/state/tw-mobile-sync/server/]]`;
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
