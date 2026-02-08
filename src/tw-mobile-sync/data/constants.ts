export const activeServerStateTiddlerTitle = `$:/state/tw-mobile-sync/activeServer`;
export const clientStatusStateTiddlerTitle = '$:/state/tw-mobile-sync/clientStatus';

export const getLoopInterval = () => (Number($tw.wiki.getTiddlerText('$:/plugins/linonetwo/tw-mobile-sync/Config/SyncInterval')) || 3) * 1000;
