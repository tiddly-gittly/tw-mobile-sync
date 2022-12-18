import structuredClone from '@ungap/structured-clone';
import type { IClientInfo } from '../types';
import { loopInterval } from './constants';

const keyTimeout = loopInterval * 10;

export class ClientInfoStore {
  #clients: Record<string, IClientInfo> = {};
  loopHandel: NodeJS.Timer;

  constructor() {
    this.loopHandel = setInterval(() => {
      Object.keys(this.#clients).forEach((key) => {
        const timestamp = this.#clients[key].timestamp;
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!timestamp || Date.now() - timestamp > keyTimeout) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this.#clients[key];
        }
      });
    }, loopInterval);
  }

  get allClient() {
    return structuredClone(this.#clients);
  }

  updateClient(name: string, value: IClientInfo) {
    this.#clients[name] = { ...this.#clients[name], ...value };
  }
}
