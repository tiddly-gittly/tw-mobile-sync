/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { cd } from 'zx';

/**
 * Put plugin into demo folder
 */
const pluginInfo = fs.readJsonSync('src/plugin.info');
const [_, __, author, name] = pluginInfo.title.split('/');
const pluginTitle = `${author}/${name}`;

const repoDirectory = path.resolve(__dirname, '..');
const distDirectory = path.resolve(repoDirectory, 'dist');
const jsonPluginFileName = `$__plugins_${pluginTitle.replace('/', '_')}.json`;
// copy demo
await fs.copy(path.join(repoDirectory, 'demo'), distDirectory);
// copy json plugin
await fs.copy(path.join(distDirectory, 'out', jsonPluginFileName), path.join(distDirectory, 'tiddlers', jsonPluginFileName));

/**
 * Same as `cross-env TIDDLYWIKI_PLUGIN_PATH='node_modules/tiddlywiki/plugins/published' TIDDLYWIKI_THEME_PATH='${wikiFolderName}/themes'`
 *
 * But we don't need this, because we put the JSON plugin into the dist folder, it will be loaded automatically
 */
// process.env.TIDDLYWIKI_PLUGIN_PATH = `${distDir}/plugins`;

cd(distDirectory);
await $`tiddlywiki . --build index`;
