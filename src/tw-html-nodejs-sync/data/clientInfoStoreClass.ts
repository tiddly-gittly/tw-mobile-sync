import structuredClone from '@ungap/structured-clone';
import { UAParser } from 'ua-parser-js';
import * as types from '../types';
import { getLoopInterval } from './constants';

export class ClientInfoStore {
  #clients: Record<string, types.IClientInfo> = {};
  loopHandel: NodeJS.Timeout;

  constructor() {
    const loopInterval = getLoopInterval();
    const keyOfflineTimeout = loopInterval * 2;
    const keyDeleteTimeout = loopInterval * 10;
    this.loopHandel = setInterval(() => {
      Object.keys(this.#clients).forEach((key) => {
        const timestamp = this.#clients[key].timestamp;

        if (!timestamp || Date.now() - timestamp > keyDeleteTimeout) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this.#clients[key];
        } else if (Date.now() - timestamp > keyOfflineTimeout) {
          this.#clients[key].state = types.ConnectionState.offline;
        }
      });
    }, loopInterval);
  }

  get allClient(): Record<string, types.IClientInfo> {
    return structuredClone(this.#clients) as Record<string, types.IClientInfo>;
  }

  updateClient(key: string, value: Partial<types.IClientInfo>): void {
    this.#clients[key] = { ...this.#clients[key], ...value };
    const ua = this.#clients[key]['User-Agent'];
    if (ua) {
      const userAgentInfo = UAParser(ua);
      const model = userAgentInfo.device?.model;
      const os = userAgentInfo.os?.name;
      const browserName = userAgentInfo.browser?.name;
      this.#clients[key].name = model ?? browserName ?? this.#clients[key].Origin;
      this.#clients[key].model = model;
      this.#clients[key].os = os;
    } else {
      this.#clients[key].name = this.#clients[key].Origin;
    }
  }
}
