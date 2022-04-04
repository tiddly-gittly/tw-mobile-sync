import { cd } from 'zx';

// We need a HTML demo as client
cd('./dist/output');
void $`serve .`; // allow this server to run without await
console.log(`nodejs: http://localhost:3001/
html: http://localhost:3000/`);
// And a nodejs server to receive data
cd('..');
await $`tiddlywiki +plugins/tiddlywiki/filesystem +plugins/tiddlywiki/tiddlyweb . --listen port=3001 root-tiddler=$:/core/save/lazy-images`;