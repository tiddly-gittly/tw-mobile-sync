const LANGUAGE_BASE = '$:/plugins/linonetwo/tw-mobile-sync/language';

function getWikiLanguage(): string {
  return $tw.wiki.getTiddlerText('$:/language')?.trim() || 'en-GB';
}

/** Server-side lookup matching the plugin's <<lingo>> .multids keys. */
export function lingo(key: string): string {
  const locales = [getWikiLanguage(), 'en-GB'];
  for (const locale of locales) {
    const text = $tw.wiki.getTiddlerText(`${LANGUAGE_BASE}/${locale}/${key}`);
    if (text !== undefined && text !== '') {
      return text;
    }
  }
  return key;
}

export function lingoWithCount(key: string, count: number): string {
  return lingo(key).replace('{{count}}', String(count));
}
