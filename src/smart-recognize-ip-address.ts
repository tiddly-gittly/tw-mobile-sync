import trim from 'lodash/trim';

function recognize(tiddlerName: string | undefined) {
  if (tiddlerName === undefined) {
    return;
  }
  const textFieldTiddler = $tw.wiki.getTiddler(tiddlerName);
  if (textFieldTiddler === undefined) {
    return;
  }
  if (typeof textFieldTiddler.fields.text !== 'string' || trim(textFieldTiddler.fields.text).length === 0) {
    return;
  }
  // example input is like `http://192.168.10.103:5214/#%E6%89%93%E5%BC%80CDDA%E5%9C%A8Mac%E4%B8%8A%E7%9A%84%E6%95%B0%E6%8D%AE%E6%96%87%E4%BB%B6%E5%A4%B9`
  const regex = /((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])[\.。]){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))[:：]([0-9]{2,5})/gm;
  let match: RegExpExecArray | null;
  let ipAddress: string | undefined;
  let port: string | undefined;
  while ((match = regex.exec(textFieldTiddler.fields.text)) !== null) {
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    match.forEach((match, groupIndex) => {
      console.log(`Found match, group ${groupIndex}: ${match}`);
      if (groupIndex === 1) {
        ipAddress = match;
      }
      if (groupIndex === 5) {
        port = match;
      }
    });
  }
  if (ipAddress !== undefined || port !== undefined) {
    const newServerInfoTiddler = {
      title: tiddlerName,
      text: textFieldTiddler.fields.text,
      ipAddress,
      port,
    };
    $tw.wiki.addTiddler(newServerInfoTiddler);
  }
}

exports.startup = () => {
  $tw.rootWidget.addEventListener('tw-mobile-sync-smart-recognize-ip-address', (event) => recognize(event.param));
};
