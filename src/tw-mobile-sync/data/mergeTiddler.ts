/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { applyPatches, makePatches } from '@sanity/diff-match-patch';
import type { ITiddlerFields } from 'tiddlywiki';

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
