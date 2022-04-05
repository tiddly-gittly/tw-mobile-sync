import { cd } from 'zx';
import defaultGateway from 'default-gateway';

const { gateway } = await defaultGateway.v4();

// And a nodejs server to receive data
cd('./dist');
void $`tiddlywiki +plugins/tiddlywiki/filesystem +plugins/tiddlywiki/tiddlyweb . --listen host=0.0.0.0 port=3001 root-tiddler=$:/core/save/lazy-images`;

// We need a HTML demo as client
cd('./output');
void $`serve .`; // allow this server to run without await
