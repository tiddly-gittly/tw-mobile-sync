export const activeServerStateTiddlerTitle = `$:/state/tw-html-nodejs-sync/activeServer`;
export const clientStatusStateTiddlerTitle = '$:/state/tw-html-nodejs-sync/clientStatus';
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
export const getLoopInterval = () => (Number($tw.wiki.getTiddlerText('$:/plugins/linonetwo/tw-html-nodejs-sync/Config/SyncInterval')) || 3) * 60 * 1000;
