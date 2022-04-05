import { cd } from 'zx';
import defaultGateway from 'default-gateway';

const { gateway } = await defaultGateway.v4();

// We need a HTML demo as client
cd('./dist/output');
void $`serve .`; // allow this server to run without await
// And a nodejs server to receive data
cd('..');
void $`tiddlywiki +plugins/tiddlywiki/filesystem +plugins/tiddlywiki/tiddlyweb . --listen port=3001 root-tiddler=$:/core/save/lazy-images`;

console.log(`
nodejs: http://${gateway}:3001/
html: http://${gateway}:3000/
`);
