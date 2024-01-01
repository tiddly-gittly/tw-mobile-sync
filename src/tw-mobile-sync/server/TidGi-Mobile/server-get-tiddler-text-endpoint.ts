/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type Http from 'http';
import type { ServerEndpointHandler } from 'tiddlywiki';

exports.method = 'GET';

/**
 * Used to sync text field of a skinny tiddler.
 * Due to use of Base64, this is not suitable for large files.
 *
 * RFC 2045中定义的MIME(多用途Internet邮件扩展)规范将“base64”列为几种二进制到文本编码方 案之一。MIME的base64编码基于RFC 1421版本的隐私增强邮件(PEM)，它使用与PEM相同的64字 符字母和编码机制，并且使用“=”符号以相同方式输出填充。
MIME不为base64编码行指定固定长度，但指定的最大长度为76个字符。此外，它指定兼容解码器 必须忽略任何非字母字符，尽管大多数实施使用CR/LF换行符对来分隔编码行。
因此，符合MIME标准的base64编码二进制数据的实际长度通常约为原始数据长度的137%，但对于 非常短的邮件，由于报头的开销，开销可能会高很多。基本上，base64编码的二进制数据的最终大 小等于原始数据大小的1.37倍+ 814字节(对于报头)。(https://www.cisco.com/c/zh_cn/support/docs/security/email-security-appliance/118499-qa-esa-00.pdf)
 *
 * Used in TidGi-Mobile's src/services/BackgroundSyncService/index.ts
*/
exports.path = /^\/tw-mobile-sync\/get-tiddler-text\/(.+)$/;

const handler: ServerEndpointHandler = function handler(request: Http.ClientRequest, response: Http.ServerResponse, context) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const encodedTitle = context.params?.[0];
  if (!encodedTitle) {
    response.writeHead(400);
    response.end(`No title in tw-mobile-sync/get-tiddler-text/{title}`, 'utf8');
    return;
  }
  const title = $tw.utils.decodeURIComponentSafe(encodedTitle);
  const text = context.wiki.getTiddlerText(title);

  if (!text) {
    response.writeHead(404);
    response.end(`No text for ${title}`, 'utf8');
    return;
  }

  try {
    response.writeHead(200, { 'Content-Type': 'text/text', 'Content-Length': Buffer.byteLength(text) });
    response.end(text, 'utf8');
  } catch (error) {
    response.writeHead(500);
    response.end(`Failed to get tiddler text for ${title} , ${(error as Error).message} ${(error as Error).stack ?? ''}`, 'utf8');
  }
};

exports.handler = handler;
