export function getDiffFilter(lastSync: string | undefined) {
  return `[all[]] :filter[get[modified]compare:date:gt[${lastSync ?? ''}]]`;
}

/**
 * also in src/ui/ServerList.tid 's list widget
 */
export const serverListFilter = `[prefix[$:/state/tw-mobile-sync/server/]] -[[$:/state/tw-mobile-sync/server/new]] -[[$:/state/tw-mobile-sync/server/new/scan-qr-widget-open]] -[[$:/state/tw-mobile-sync/server/existed/scan-qr-widget-open]] -[[$:/state/tw-mobile-sync/server/existed/update]]`;
