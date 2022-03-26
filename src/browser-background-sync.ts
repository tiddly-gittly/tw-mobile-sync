import type { Widget as IWidget, Tiddler, IServerStatus } from 'tiddlywiki';
import { activeServerStateTiddlerTitle } from './constants';
import { getStatusEndPoint, getSyncEndPoint } from './sync/getEndPoint';

exports.name = 'browser-background-sync';
exports.platforms = ['browser'];
// modules listed in https://tiddlywiki.com/dev/#StartupMechanism
// not blocking rendering
exports.after = ['render'];
exports.synchronous = true;

const Widget = (require('$:/core/modules/widgets/widget.js') as { widget: typeof IWidget }).widget;

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
    status: ServerState;
    name: string;
    ipAddress: string;
    port: number;
  };
}

class BackgroundSyncManager {
  loop: ReturnType<typeof setInterval> | undefined;
  loopInterval = 1000 * 60 * 5; // 5 minutes
  /** lock the sync while last one is still on progress */
  lock: boolean = false;

  constructor() {
    // TODO: get this from setting
    this.loopInterval = 1000 * 60 * 5; // 5 minutes
  }

  start() {
    this.loop = setInterval(async () => {
      if (this.lock) {
        return;
      }
      this.lock = true;
      try {
        await this.getServerStatus();
        await this.syncWithServer();
      } finally {
        this.lock = false;
      }
    }, this.loopInterval);
  }

  async getServerStatus() {
    const activeTiddlerTitle = $tw.wiki.getTiddlerText(activeServerStateTiddlerTitle);
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
                status: active ? ServerState.onlineActive : ServerState.online,
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
            status: active ? ServerState.offlineActive : ServerState.offline,
          },
        };
      }),
    );
    serverListWithUpdatedStatus.forEach((tiddler) => {
      $tw.wiki.setTiddlerData(tiddler.fields.title, undefined, tiddler.fields);
    });
  }

  async syncWithServer() {
    const onlineActiveServer = this.serverList.find((serverInfoTiddler) => {
      return serverInfoTiddler?.fields?.status === ServerState.onlineActive;
    });

    if (onlineActiveServer !== undefined) {
      const diffFromServer = await fetch(getSyncEndPoint(onlineActiveServer.fields.ipAddress, onlineActiveServer.fields.port), {
        method: 'POST',
        // TODO: add auth token in header, after we can scan QR code to get token easily
      }).then((response) => response.json());
    }
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
