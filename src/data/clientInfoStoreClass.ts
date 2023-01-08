/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import structuredClone from '@ungap/structured-clone';
import * as types from '../types';
import { getLoopInterval } from './constants';
import UAParser from 'ua-parser-js';

export class ClientInfoStore {
  #clients: Record<string, types.IClientInfo> = {};
  loopHandel: NodeJS.Timer;

  constructor() {
    const loopInterval = getLoopInterval();
    const keyOfflineTimeout = loopInterval * 2;
    const keyDeleteTimeout = loopInterval * 10;
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

  updateClient(name: string, value: Partial<types.IClientInfo>) {
    this.#clients[name] = { ...this.#clients[name], ...value };
    const ua = this.#clients[name]['User-Agent'];
    if (ua) {
      const userAgentInfo = new UAParser(ua);
      const model = userAgentInfo.getDevice().model;
      const os = userAgentInfo.getOS().name; // 获取系统
      this.#clients[name].name = model ?? userAgentInfo.getBrowser().name ?? this.#clients[name].Origin;
      this.#clients[name].model = model;
      this.#clients[name].os = os;
    } else {
      this.#clients[name].name = this.#clients[name].Origin;
    }
  }
}
