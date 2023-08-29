# TiddlyWiki5 Mobile Sync

Sync data between Mobile HTML (Tiddloid/Quine2/TidGi-Mobile) <-> Desktop App (TidGi/NodeJS).

## Why this plugin

To enjoy the [REST API of TiddlyWiki](https://tiddlywiki.com/#WebServer%20API) and **privacy of local stored** data, we choose to use [TidGi](https://github.com/tiddly-gittly/TidGi-Desktop) on the Desktop.

We can open localhost wiki on the [Tiddloid](https://github.com/donmor/Tiddloid) or on a browser on the Mobile, but it's not possible to sync data back to the desktop, if the ip of desktop wiki has changed. (Mobile don't know where is the desktop wiki to sync back.) So we need a plugin to keep track of the known ip of the desktop wiki, allow user to click on a desktop ip and sync data back to that desktop wiki.

And you may write some tiddlers in the subway when you getting home, these tiddlers may have conflict with the one in your home's desktop wiki, we need this plugin to handle it.

## Usage

See [Demo site](http://tiddly-gittly.github.io/tw-mobile-sync/) or [src/readme.tid](src/readme.tid).

## How this works (TODO)

和手机同步的插件，不做成 saver，就是做成一个按钮，以保证不和 saver 冲突。

保存一个服务器列表和相应的最近同步时间（如果服务器重启 wifi 之后 ip 变了，时间会归古）
在手机上点击同步按钮后，筛选本地创建或修改时间晚于同步时间的条目，以及上次同步时间，POST 给 nodejs 端的 API。
nodejs 端写一个服务端 api 来接收 POST 请求，如果服务端修改时间都早于上次同步时间，就用客户端的覆盖，如果服务端有晚于上次同步时间的要被覆盖了，就用 conflict mark 把两边的内容合到一起去，然后用 server send 来催促界面更新。
然后服务端同样返回一个 JSON 列表，把覆盖操作后的，上次同步以来的条目返回给 HTML 端，HTML 端同样覆盖内容到本地。

如果有冲突的地方是字段内容就麻烦了，比如 modify time 就肯定会冲突。所以干脆忽略字段的冲突，用一个配置项来规定字段冲突时使用哪一边的，默认用手机端的。

如果能用 git 获取到上一个版本，则用 https://www.npmjs.com/package/node-diff3 圈定比较准确的冲突范围给用户看。实际上冲突应该不多，所以这个应该不常运行。

按下同步按钮后会弹出一个服务器列表，可以新建。然后每个服务器上有一个绿灯表示可连通（所以还需要一个 get 的 status API 表示已安装同步插件）
还显示上次同步时间到现在的距离。

也可以在移动端修改条目之前，将内容存放在一个 state tiddler 里，从而用上三路消歧。
