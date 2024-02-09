/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import structuredClone from '@ungap/structured-clone';
import UAParser from 'ua-parser-js';
import * as types from '../types';
import { getLoopInterval } from './constants';

export class ClientInfoStore {
  #clients: Record<string, types.IClientInfo> = {};
  loopHandel: NodeJS.Timer;

  constructor() {
    const loopInterval = getLoopInterval();
    const keyOfflineTimeout = loopInterval * 2 * 60;
    const keyDeleteTimeout = loopInterval * 10 * 60;
    this.loopHandel = setInterval(() => {
      Object.keys(this.#clients).forEach((key) => {
        const timestamp = this.#clients[key].timestamp;
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!timestamp || Date.now() - timestamp > keyDeleteTimeout) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this.#clients[key];
        } else if (Date.now() - timestamp > keyOfflineTimeout) {
          this.#clients[key].state = types.ConnectionState.offline;
        }
      });
    }, loopInterval);
  }

  get allClient() {
    return structuredClone(this.#clients);
  }

  updateClient(key: string, value: Partial<types.IClientInfo>) {
    this.#clients[key] = { ...this.#clients[key], ...value };
    const ua = this.#clients[key]['User-Agent'];
    if (ua) {
      const userAgentInfo = new UAParser(ua);
      const model = userAgentInfo.getDevice().model;
      const os = userAgentInfo.getOS().name; // 获取系统
      this.#clients[key].name = model ?? userAgentInfo.getBrowser().name ?? this.#clients[key].Origin;
      this.#clients[key].model = model;
      this.#clients[key].os = os;
    } else {
      this.#clients[key].name = this.#clients[key].Origin;
    }
  }
}
