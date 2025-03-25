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
  const aIsBinary = isBinaryTiddler(a);
  const bIsBinary = isBinaryTiddler(b);
  if ((!aIsBinary && !bIsBinary) || (bIsBinary && bIsBinary)) {
    return newerOne;
  } else if (leftIsBinaryRightIsString(aIsBinary, bIsBinary)) {
    // we choose binary, because we assume binary data is more important than pure text
    return a;
  } else if (leftIsBinaryRightIsString(bIsBinary, aIsBinary)) {
    return b;
  }
  // TODO: currently only return a;
  return a;
  // both is string tiddler, we can merge them using diff-match-patch algorithm
  // FIXME: Currently not working, it needs `c` that is an older version from server to work (3-way-merge), otherwise it will just use `b.text` as the merged text
  // const dmpObject = new dmp.diff_match_patch()
  // const patches = dmpObject.diff_main(a.text, b.text);
  // const [mergedText] = applyPatches(patches, a.text);
  // const fields: ITiddlerFields = {
  //   ...newerOne,
  //   text: mergedText,
  // };
  // return fields;
}

function leftIsBinaryRightIsString(aIsBinary: boolean, bIsBinary: boolean) {
  // a is binary, b is string
  if (aIsBinary && !bIsBinary) {
    return true;
  }
  return false;
}

export function isBinaryTiddler(tiddlerFields: ITiddlerFields): boolean {
  const contentTypeInfo = $tw.config.contentTypeInfo[tiddlerFields.type || 'text/vnd.tiddlywiki'];
  return !!contentTypeInfo && contentTypeInfo.encoding === 'base64';
}
