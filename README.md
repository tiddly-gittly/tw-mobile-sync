# TiddlyWiki5 Mobile Sync

Sync data between Mobile HTML (Tiddloid) <-> Desktop App (TidGi).

## How this works

和手机同步的插件，不做成 saver，就是做成一个按钮，以保证不和 saver 冲突。

保存一个服务器列表和相应的最近同步时间（如果服务器重启 wifi 之后 ip 变了，时间会归古）
在手机上点击同步按钮后，筛选本地创建或修改时间晚于同步时间的条目，以及上次同步时间，POST 给 nodejs 端的 API。
nodejs 端写一个服务端 api 来接收 POST 请求，如果服务端修改时间都早于上次同步时间，就用客户端的覆盖，如果服务端有晚于上次同步时间的要被覆盖了，就用 conflict mark 把两边的内容合到一起去，然后用 server send 来催促界面更新。
然后服务端同样返回一个 JSON 列表，把覆盖操作后的，上次同步以来的条目返回给 HTML 端，HTML 端同样覆盖内容到本地。

如果有冲突的地方是字段内容就麻烦了，比如 modify time 就肯定会冲突。所以干脆忽略字段的冲突，用一个配置项来规定字段冲突时使用哪一边的，默认用手机端的。

如果能用 git 获取到上一个版本，则用 https://www.npmjs.com/package/node-diff3 圈定比较准确的冲突范围给用户看。实际上冲突应该不多，所以这个应该不常运行。

按下同步按钮后会弹出一个服务器列表，可以新建。然后每个服务器上有一个绿灯表示可连通（所以还需要一个 get 的 status API 表示已安装同步插件）
还显示上次同步时间到现在的距离。
