# dsh-portable

把官方 DeepSeek Harness（网页版 `dsh web`）装进 U 盘，插到任何电脑上都能跑。支持 Apple Silicon Mac 和 64 位 Windows。

## 安装到 U 盘

U 盘格式化为 exFAT，然后在 Mac 上运行：

```sh
./build.sh "/Volumes/<U盘名>"
```

需要 `hdiutil`（macOS 自带）、`7zz`（`brew install sevenzip`）和 `npx`。脚本会从官方更新源下载桌面版并校验 SHA512，生成两个只读镜像，再拷进 U 盘。

## U 盘内容

```
DSH-Mac.command      双击启动（Mac）
DSH-Windows.bat      双击启动（Windows）
dsh-mac-arm64.dmg    程序镜像，压缩的只读镜像
dsh-win-x64.iso      程序镜像，只读
home/                DSH_HOME：API key、设置、会话（所有电脑共用）
  machines/          每台电脑自己的工作区登记表
  share-space.json   共享空间：当前加入的空间口令（插件自己写）
```

## 设计

- **程序打包成镜像**：U 盘读写小文件很慢，镜像只是一个大文件，拷贝和启动都快。Mac 版在挂载前会先把整个 dmg 顺序读一遍，好让系统缓存起来（冷启动从 18 秒降到 5 秒）。Windows 挂载 ISO 时不走系统缓存，预读反而更慢，所以没加。
- **尽量用原生的**：镜像里是官方桌面版的原始文件，启动脚本只设置 `DSH_HOME` 和 `DSH_PRIMARY_RUNTIME`，然后运行 `dsh web`。
- `python.patch.yml`：让网页版加载官方自带的 Python 和 Office skills。构建时从官方 `dsh-sdk-app` 的补丁里原样提取，官方改了也能自动跟上。
- `src/per-machine.patch.yml`：工作区登记表里存的是绝对路径，只在创建它的那台电脑上有效。所以每台电脑单独存一份，位置是 `home/machines/<用户名-机器ID>/`。API key、设置和会话记录仍然共用。
- `src/exfat-link.mjs`：exFAT 不支持硬链接，dsh 新建会话时要用硬链接。这个脚本只在硬链接失败时，改为"不覆盖已有文件"的复制。
- **Windows 备用方案**：电脑不允许挂载 ISO 时，用系统自带的 `tar` 把镜像解压到 U 盘上的 `dsh-win-x64/`（只做一次）。

## 共享空间插件

dsh 左侧栏多一个「共享空间」：文件存在公网服务器上（`https://mochif.com/share-space`），输入同一个口令的人在同一个空间里，可以上传、查看、下载、删除。

- **加入 / 创建**：在页面里输入别人给的口令就加入；输入新口令和创建码就建一个新空间。创建码只有服务器主人知道（服务器 `/opt/share-space/.env` 里的 `SHARE_CREATE_CODE`），这样陌生人建不了空间。每份 dsh 同一时间只在一个空间里，口令记在 U 盘的 `home/share-space.json`，换电脑也还在。
- **手机网页**：手机、平板或没装 dsh 的电脑，直接用浏览器打开 `https://mochif.com/share-space/`，功能和插件一样。图片显示成缩略图，点开看大图、左右滑动切换，长按能保存到相册；视频、音频能直接播放。网页在这台设备上记住口令，cookie 只在 `/share-space/` 路径下有效。
- **退出 / 解散**：谁都能退出（空间和文件还在，用口令还能再加入）；创建者那份 dsh 记着一把解散钥匙，能把整个空间连同文件删掉。
- `src/share-space/`：dsh 插件（不用构建）。主机端在 dsh 的 Web 服务器上挂 `/share-space/`，带上口令转发给服务器；每个请求先过 dsh 自己的 Host/Origin 和登录 cookie 检查。别人上传的文件在 dsh 的源下打开时一律加 CSP sandbox 和 nosniff：图片、音视频直接显示，代码和文本（包括 HTML）按纯文本显示，其余一律下载，所以文件里的脚本碰不到 dsh 的接口。
- `src/share-space.patch.yml`：把插件加进网页版，服务器地址写在这里。dsh 只解析安装锚点（`@deepseek-ai/dsh/package.json`）依赖闭包里的包，所以 build.sh 把插件拷进 `dsh/node_modules/`，并在那个 package.json 里登记成依赖。
- `server/`：服务端，只用 Python 标准库，`web/` 是手机网页（纯 HTML/CSS/JS，严格 CSP，文件名一律当文本插入）。空间目录名是口令的 SHA-256，口令本身不落盘；按 IP 限制猜口令和创建码的次数；单个文件、单个空间、全部空间各有上限。`docker-compose.yml` 是部署方式，`Caddyfile.snippet` 是反代配置。
