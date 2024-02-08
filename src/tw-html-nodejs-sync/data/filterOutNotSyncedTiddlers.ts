import { ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';

let tiddlersToNotSync: Set<string> | undefined;
let prefixToNotSync: string[] | undefined;
export const filterOutNotSyncedTiddlers = <T extends ITiddlerFieldsParam | ITiddlerFields>(tiddlers: T[]): T[] => {
  if (tiddlersToNotSync === undefined || prefixToNotSync === undefined) {
    tiddlersToNotSync = new Set(
      $tw.utils.parseStringArray($tw.wiki.getTiddlerText('$:/plugins/linonetwo/tw-html-nodejs-sync/Config/TiddlersToNotSync') ?? ''),
    );
    prefixToNotSync = $tw.utils.parseStringArray($tw.wiki.getTiddlerText('$:/plugins/linonetwo/tw-html-nodejs-sync/Config/TiddlersPrefixToNotSync') ?? '');
  }
  return tiddlers
    .filter((tiddler: T) => !prefixToNotSync!.some((prefix) => (tiddler.title as string).startsWith(prefix)))
    .filter((tiddler: T) => !tiddlersToNotSync!.has(tiddler.title as string));
};
