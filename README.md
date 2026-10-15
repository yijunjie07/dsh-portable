# dsh-usb

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
home/                DSH_HOME：配置、API key、会话，两个系统共用
```

## 设计

- **程序打包成镜像**：U 盘读写小文件很慢，镜像只是一个大文件，拷贝和启动都快。Mac 版在挂载前会先把整个 dmg 顺序读一遍，好让系统缓存起来。
- **尽量用原生的**：镜像里是官方桌面版的原始文件，启动脚本只设置 `DSH_HOME` 和 `DSH_PRIMARY_RUNTIME`，然后运行 `dsh web`。
- `src/python.patch.yml`：让网页版加载官方自带的 Python 和 Office skills。内容是从 `dsh-sdk-app` 原样复制来的两行配置。
- `src/exfat-link.mjs`：exFAT 不支持硬链接，dsh 新建会话时要用硬链接。这个脚本只在硬链接失败时，改为"不覆盖已有文件"的复制。
- **Windows 备用方案**：电脑不允许挂载 ISO 时，用系统自带的 `tar` 把镜像解压到 U 盘上的 `dsh-win-x64/`（只做一次）。
