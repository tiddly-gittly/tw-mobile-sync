/* eslint-disable unicorn/no-array-callback-reference */
import { clientStatusStateTiddlerTitle, getLoopInterval } from '../data/constants';
import { getClientInfoPoint } from '../data/getEndPoint';
import type { IClientInfo } from '../types';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.name = 'tw-mobile-sync-browser-background-sync';
exports.platforms = ['browser'];
exports.after = ['render'];
exports.synchronous = true;

class BackgroundSyncManager {
  loop: ReturnType<typeof setInterval> | undefined;
  loopInterval: number;
  /** lock the sync for `this.syncWithServer`, while last sync is still on progress */
  lock = false;

  constructor() {
    // TODO: get this from setting
    this.loopInterval = getLoopInterval();
  }

  async start() {
    const isInTidGiMobile = $tw.wiki.getTiddlerText('$:/info/tidgi-mobile') === 'yes';
    if (isInTidGiMobile) return;
    if (this.loop !== undefined) {
      clearInterval(this.loop);
      this.lock = false;
    }
    await this.getConnectedClientStatus();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/promise-function-async
    this.loop = setInterval(() => this.getConnectedClientStatus(), this.loopInterval);
  }

  /** On TidGi desktop, get connected client info */
  async getConnectedClientStatus() {
    try {
      const baseUrl = $tw.wiki.getTiddlerText('$:/info/url/full');
      if (baseUrl?.startsWith?.('http') !== true) {
        clearInterval(this.loop);
        return;
      }
      const response: Record<string, IClientInfo> = await fetch(getClientInfoPoint(baseUrl)).then(
        async (response) => (await response.json()) as Record<string, IClientInfo>,
      );
      Object.values(response).forEach((clientInfo) => {
        $tw.wiki.addTiddler({
          title: `${clientStatusStateTiddlerTitle}/${clientInfo['User-Agent']}`,
          ...clientInfo,
        });
      });
    } catch (error) {
      console.warn(`tw-html-nodejs-sync can't connect to tw nodejs side. Error: ${(error as Error).message}`);
    }
  }

  /**
   *  update last sync using <<now "[UTC]YYYY0MM0DD0hh0mm0ssXXX">>
   */
  getLastSyncString() {
    return $tw.utils.stringifyDate(new Date());
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = () => {
  const syncManager = new BackgroundSyncManager();
  void syncManager.start();
};
