/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.getSidebarWidthInPx = function (source: (argument0: (_tiddler: any, input: string) => void) => void, _operator: any, _options: any) {
  const results: string[] = [];
  source(function (_tiddler: any, input: string) {
    if (input.endsWith('px')) {
      results.push(input.replace('px', ''));
    } else if (input.endsWith('vw')) {
      const vwPercentage = Number(input.replace('vw', '')) / 100;
      results.push(String(Math.floor(window.innerWidth * vwPercentage)));
    } else {
      results.push(input);
    }
  });
  return results;
};
