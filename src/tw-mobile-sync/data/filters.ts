export function getServerChangeFilter(lastSync: string | undefined) {
  return `[all[]] :filter[get[modified]compare:date:gt[${lastSync ?? ''}]]`;
}

/**
 * also in src/ui/ServerList.tid 's list widget
 */
export const getServerListFilter = () => $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tw-mobile-sync/ServerListFilter');
