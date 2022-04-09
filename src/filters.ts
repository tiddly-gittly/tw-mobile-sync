export function getDiffFilter(lastSync: string | undefined) {
  return `[all[]!is[system]] :filter[get[modified]compare:date:gt[${lastSync ?? ''}]]`;
}

/**
 * also in src/ui/ServerList.tid 's list widget
 */
export const serverListFilter: string = `[prefix[$:/state/tw-mobile-sync/server/]] -[[$:/state/tw-mobile-sync/server/new]] -[[$:/state/tw-mobile-sync/server/new/scan-qr-widget-open]]`;
