import structuredClone from '@ungap/structured-clone';
import { ConnectionState, IClientInfo } from '../types';
import { loopInterval } from './constants';

const keyOfflineTimeout = loopInterval * 2;
const keyDeleteTimeout = loopInterval * 10;

export class ClientInfoStore {
  #clients: Record<string, IClientInfo> = {};
  loopHandel: NodeJS.Timer;

  constructor() {
    this.loopHandel = setInterval(() => {
      Object.keys(this.#clients).forEach((key) => {
        const timestamp = this.#clients[key].timestamp;
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!timestamp || Date.now() - timestamp > keyDeleteTimeout) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this.#clients[key];
        } else if (Date.now() - timestamp > keyOfflineTimeout) {
          this.#clients[key].state = ConnectionState.offline;
        }
      });
    }, loopInterval);
  }

  get allClient() {
    return structuredClone(this.#clients);
  }

  updateClient(name: string, value: Partial<IClientInfo>) {
    this.#clients[name] = { ...this.#clients[name], ...value };
  }
}
