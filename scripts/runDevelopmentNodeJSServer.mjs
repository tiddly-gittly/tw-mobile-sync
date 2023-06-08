/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { internalIpV4 } from 'internal-ip';
import { getPort } from 'get-port-please';

const port = await getPort({ port: 3001 });
echo('Should run this after npm run dev');
echo(`Open http://${await internalIpV4()}:${port}/`);
await $`tiddlywiki +plugins/tiddlywiki/filesystem +plugins/tiddlywiki/tiddlyweb ./dist --listen port=${port} host=0.0.0.0 root-tiddler=$:/core/save/lazy-images`;
