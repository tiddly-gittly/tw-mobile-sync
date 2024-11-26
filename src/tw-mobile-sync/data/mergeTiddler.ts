/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { ITiddlerFields } from 'tiddlywiki';

var dmp = require("$:/core/modules/utils/diff-match-patch/diff_match_patch.js");

/**
 *
 * @url https://neil.fraser.name/software/diff_match_patch/demos/patch.html
 * @param a
 * @param b
 * @returns
 */
export function mergeTiddler(a: ITiddlerFields, b: ITiddlerFields): ITiddlerFields {
  if (a.title !== b.title) {
    throw new Error(`Cannot merge tiddlers with different titles: ${a.title} and ${b.title}`);
  }
  const newerOne = a.modified > b.modified ? a : b;
  if (leftIsBinaryRightIsString(a, b)) {
    // we choose binary, because we assume binary data is more important than pure text
    return a;
  } else if (leftIsBinaryRightIsString(b, a)) {
    return b;
  } else if (isBinaryTiddler(a) && isBinaryTiddler(b)) {
    return newerOne;
  }
  // both is string tiddler, we can merge them using diff-match-patch algorithm
  // FIXME: Currently not working, it needs `c` that is an older version from server to work (3-way-merge), otherwise it will just use `b.text` as the merged text
  // FIXME: `Error when processing tiddler { title: '2024-03-19T13:45:00+08:00', created: '20240319063429986', creator: '林一二', startDate: '20240319054500000', endDate: '20240319063000000', calendarEntry: 'yes', tags: 'xxx', modified: '20240319063429986', modifier: '林一二', caption: 'yyy', type: 'text/vnd.tiddlywiki', text: '' } Error: Unknown call format to make() at make ($:/plugins/linonetwo/tw-mobile-sync/server-sync-v1-endpoint.js:1:19900) at mergeTiddler ($:/plugins/linonetwo/tw-mobile-sync/server-sync-v1-endpoint.js:1:25987) at $:/plugins/linonetwo/tw-mobile-sync/server-sync-v1-endpoint.js:9:1558 at Array.forEach (<anonymous>) at Object.handler2 [as handler] ($:/plugins/linonetwo/tw-mobile-sync/server-sync-v1-endpoint.js:9:1426) at IncomingMessage.<anonymous> ($:/core/modules/server/server.js:308:10) at IncomingMessage.emit (node:events:517:28) at endReadableNT (node:internal/streams/readable:1368:12) at processTicksAndRejections (node:internal/process/task_queues:82:21)`
  const patches = makePatches(a.text, b.text);
  const [mergedText] = applyPatches(patches, a.text);
  const fields: ITiddlerFields = {
    ...newerOne,
    text: mergedText,
  };
  return fields;
}

function leftIsBinaryRightIsString(a: ITiddlerFields, b: ITiddlerFields) {
  // a is binary, b is string
  if (isBinaryTiddler(a) && !isBinaryTiddler(b)) {
    return true;
  }
  return false;
}

export function isBinaryTiddler(tiddlerFields: ITiddlerFields): boolean {
  const contentTypeInfo = $tw.config.contentTypeInfo[tiddlerFields.type || 'text/vnd.tiddlywiki'];
  return !!contentTypeInfo && contentTypeInfo.encoding === 'base64';
}
