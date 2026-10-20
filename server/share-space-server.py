#!/usr/bin/env python3
"""共享空间的服务端：很多个空间，每个空间是一个扁平文件夹，凭空间口令进入。

只用 Python 标准库。放在反向代理（Caddy）后面，由它提供 HTTPS 并带上 X-Forwarded-For。

- 创建空间要创建码（只有服务器主人知道，告诉信得过的人），加入空间只要空间口令。
- 口令不落盘：空间目录名是口令的 SHA-256。创建者拿到一把解散钥匙，凭它能把整个空间删掉。
- 按 IP 限制试错次数（口令不存在、创建码不对），防止猜口令。
- 同一个地址还提供手机也能用的网页（web/ 目录）。网页打开文件时没法带请求头，所以口令验证通过后
  发一个只在 /share-space/ 路径下有效的 HttpOnly cookie。
- 网页和别的站点同域名，别人上传的文件一律 CSP sandbox + nosniff：图片、音视频可以直接显示，
  文本类按纯文本显示，其余一律下载，免得文件里的脚本借这个域名运行。

环境变量：
  SHARE_CREATE_CODE   创建码（必填，至少 8 个字符）
  SHARE_DIR           数据目录，默认 /data
  SHARE_BIND          监听地址，默认 0.0.0.0
  SHARE_PORT          监听端口，默认 8080
  SHARE_MAX_FILE_MB   单个文件上限，默认 2048
  SHARE_MAX_SPACE_MB  每个空间的上限，默认 2048
  SHARE_MAX_TOTAL_MB  所有空间加起来的上限，默认 10240
  SHARE_COOKIE_PATH   网页 cookie 的路径，默认 /share-space/（Caddy 去掉前缀前的路径）

接口（空间口令放在 Authorization: Bearer <base64url(UTF-8 口令)>，网页用 cookie）：
  GET    /              网页（还有 /app.js、/app.css、/icon.svg）
  POST   /session       验证口令并发 cookie；DELETE /session 清掉 cookie
  POST   /spaces        创建空间，另带 X-Create-Code；返回解散钥匙 ownerKey
  GET    /space         空间信息（加入时用来确认空间存在）
  DELETE /space         解散空间，另带 X-Owner-Key
  GET    /files         文件列表和用量
  GET    /files/<名字>  下载；?inline=1 时安全的类型直接显示；支持 Range（手机播放视频要用）
  PUT    /files/<名字>  上传，请求体就是文件内容；重名时自动改名，返回实际文件名
  DELETE /files/<名字>  删除
"""
import base64
import re
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import shutil
import sys
import threading
import time
import unicodedata
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote

CREATE_CODE = os.environ.get("SHARE_CREATE_CODE", "")
ROOT = os.path.abspath(os.environ.get("SHARE_DIR", "/data"))
SPACES = os.path.join(ROOT, "spaces")
BIND = os.environ.get("SHARE_BIND", "0.0.0.0")
PORT = int(os.environ.get("SHARE_PORT", "8080"))
MB = 1024 * 1024
MAX_FILE = int(os.environ.get("SHARE_MAX_FILE_MB", "2048")) * MB
MAX_SPACE = int(os.environ.get("SHARE_MAX_SPACE_MB", "2048")) * MB
MAX_TOTAL = int(os.environ.get("SHARE_MAX_TOTAL_MB", "10240")) * MB
MIN_PASSPHRASE, MAX_PASSPHRASE = 8, 128
COOKIE_NAME = "share_space"
COOKIE_PATH = os.environ.get("SHARE_COOKIE_PATH", "/share-space/")
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
WEB_FILES = {"": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"),
             "/app.css": ("app.css", "text/css; charset=utf-8"), "/icon.svg": ("icon.svg", "image/svg+xml")}
PAGE_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
INLINE_TYPES = re.compile(r"^(image/(png|jpeg|gif|webp|avif|bmp)|audio/[\w.+-]+|video/[\w.+-]+)$")
TEXT_EXTENSIONS = re.compile(r"\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|xml|c|h|cc|cpp|hpp|py|js|mjs|ts|tsx|jsx|java|go|rs|rb|sh|bat|ps1|sql|css|scss|html?|vue|kt|swift|lua)$", re.I)
CHUNK = 1024 * 1024
TEMP_PREFIX = ".upload-"

# 试错限制：每个 IP 在 WINDOW 秒内最多失败 MAX_FAILURES 次；创建空间另有每小时上限
WINDOW, MAX_FAILURES = 600, 10
CREATE_WINDOW, MAX_CREATES = 3600, 5

lock = threading.Lock()
reserved = {}  # 空间 id → 正在上传的字节数，先记在账上，免得并发上传一起把空间撑爆
failures = {}  # IP → 失败时间戳
creates = {}  # IP → 创建时间戳


def recent(table, ip, window):
    now = time.monotonic()
    stamps = [t for t in table.get(ip, []) if now - t < window]
    if stamps:
        table[ip] = stamps
    else:
        table.pop(ip, None)
    return stamps


def valid_name(name):
    """只允许一层的普通文件名；点开头的留给临时文件，不对外显示。"""
    name = unicodedata.normalize("NFC", name)
    if not name or name.startswith(".") or len(name.encode()) > 255:
        return None
    if any(c in name for c in "/\\") or any(unicodedata.category(c) == "Cc" for c in name):
        return None
    return name


def space_id(passphrase):
    return hashlib.sha256(("share-space\0" + passphrase).encode()).hexdigest()


def scan(directory):
    files, used = [], 0
    with os.scandir(directory) as entries:
        for entry in entries:
            if not entry.is_file(follow_symlinks=False):
                continue
            st = entry.stat(follow_symlinks=False)
            used += st.st_size
            if not entry.name.startswith("."):
                files.append({"name": entry.name, "size": st.st_size, "mtime": int(st.st_mtime * 1000)})
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return files, used


def total_used():
    used = 0
    with os.scandir(SPACES) as entries:
        for entry in entries:
            if entry.is_dir(follow_symlinks=False) and not entry.name.startswith("."):
                used += scan(entry.path)[1]
    return used


def claim_name(directory, name):
    """在目录里占住一个不重名的文件名：a.txt → a (1).txt → a (2).txt …"""
    stem, ext = os.path.splitext(name)
    for i in range(10000):
        candidate = name if i == 0 else f"{stem} ({i}){ext}"
        if len(candidate.encode()) > 255:
            break
        try:
            os.close(os.open(os.path.join(directory, candidate), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644))
            return candidate
        except FileExistsError:
            continue
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "share-space"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.client_ip(), fmt % args))

    def client_ip(self):
        # Caddy 会把真实地址放在 X-Forwarded-For 的最后一段
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[-1].strip() or self.client_address[0]

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, code, message):
        # 请求体没读完就回错误时，让对方别再复用这条连接
        self.close_connection = True
        self.send_json(status, {"code": code, "message": message})
        return None

    def throttled(self):
        with lock:
            if len(recent(failures, self.client_ip(), WINDOW)) < MAX_FAILURES:
                return False
        self.fail(HTTPStatus.TOO_MANY_REQUESTS, "throttled", "试错太多次了，过十分钟再试")
        return True

    def count_failure(self):
        with lock:
            failures.setdefault(self.client_ip(), []).append(time.monotonic())

    def passphrase(self):
        """从 Authorization 里取出口令；格式不对时回 400 并返回 None。"""
        given = self.headers.get("Authorization", "")
        if given.startswith("Bearer "):
            token = given[len("Bearer "):].strip()
        else:
            token = self.cookie()
            if not token:
                return self.fail(HTTPStatus.UNAUTHORIZED, "no-passphrase", "缺少空间口令")
        try:
            text = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-passphrase", "口令格式不对")
        text = unicodedata.normalize("NFC", text)
        if not MIN_PASSPHRASE <= len(text) <= MAX_PASSPHRASE:
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-passphrase", f"口令要 {MIN_PASSPHRASE} 到 {MAX_PASSPHRASE} 个字符")
        return text

    def cookie(self):
        for part in self.headers.get("Cookie", "").split(";"):
            key, _, value = part.strip().partition("=")
            if key == COOKIE_NAME:
                return value
        return ""

    def set_cookie(self, token, max_age):
        self.send_header("Set-Cookie", f"{COOKIE_NAME}={token}; Path={COOKIE_PATH}; Max-Age={max_age}; HttpOnly; Secure; SameSite=Strict")

    def space(self):
        """找到口令对应的空间目录；不存在时记一次失败。"""
        if self.throttled():
            return None
        passphrase = self.passphrase()
        if passphrase is None:
            return None
        sid = space_id(passphrase)
        directory = os.path.join(SPACES, sid)
        if not os.path.isdir(directory):
            self.count_failure()
            return self.fail(HTTPStatus.NOT_FOUND, "no-space", "没有这个口令对应的空间")
        return sid, directory

    def target(self):
        """把 /files/<名字> 解析成文件名；/files 返回空串；格式不对返回 False；其他路径返回 None。"""
        path = self.path.split("?", 1)[0]
        if path in ("/files", "/files/"):
            return ""
        if not path.startswith("/files/"):
            return None
        try:
            return valid_name(unquote(path[len("/files/"):], errors="strict")) or False
        except UnicodeDecodeError:
            return False

    def route(self):
        return self.path.split("?", 1)[0].rstrip("/")

    def query(self):
        return parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}

    def serve_web(self, route):
        name, content_type = WEB_FILES[route]
        try:
            with open(os.path.join(WEB_DIR, name), "rb") as f:
                body = f.read()
        except FileNotFoundError:
            return self.fail(HTTPStatus.NOT_FOUND, "not-found", "网页文件不存在")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", PAGE_CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def info(self, sid, directory):
        files, used = scan(directory)
        with open(os.path.join(SPACES, sid + ".json")) as f:
            meta = json.load(f)
        return files, {
            "usedBytes": used, "quotaBytes": MAX_SPACE, "maxFileBytes": min(MAX_FILE, MAX_SPACE),
            "createdAt": meta.get("createdAt"), "fileCount": len(files),
        }

    def do_POST(self):
        if self.route() == "/session":
            found = self.space()
            if found:
                token = self.headers.get("Authorization", "")[len("Bearer "):].strip() or self.cookie()
                self.send_response(HTTPStatus.NO_CONTENT)
                self.set_cookie(token, 400 * 24 * 3600)
                self.send_header("Content-Length", "0")
                self.end_headers()
            return
        if self.route() != "/spaces":
            return self.fail(HTTPStatus.NOT_FOUND, "not-found", "没有这个接口")
        if self.throttled():
            return
        given = self.headers.get("X-Create-Code", "")
        if not hmac.compare_digest(given.encode(), CREATE_CODE.encode()):
            self.count_failure()
            return self.fail(HTTPStatus.FORBIDDEN, "bad-create-code", "创建码不对")
        passphrase = self.passphrase()
        if passphrase is None:
            return
        ip = self.client_ip()
        with lock:
            if len(recent(creates, ip, CREATE_WINDOW)) >= MAX_CREATES:
                return self.fail(HTTPStatus.TOO_MANY_REQUESTS, "throttled", "创建得太频繁了，过一小时再试")
            sid = space_id(passphrase)
            directory = os.path.join(SPACES, sid)
            try:
                os.mkdir(directory)
            except FileExistsError:
                return self.fail(HTTPStatus.CONFLICT, "space-exists", "这个口令已经有空间了，换一个，或者直接加入")
            owner_key = secrets.token_urlsafe(24)
            meta = {"createdAt": int(time.time() * 1000), "ownerKeyHash": hashlib.sha256(owner_key.encode()).hexdigest()}
            with open(os.path.join(SPACES, sid + ".json"), "w") as f:
                json.dump(meta, f)
            creates.setdefault(ip, []).append(time.monotonic())
        self.send_json(HTTPStatus.CREATED, {"ownerKey": owner_key})

    def do_GET(self):
        route = self.route()
        if route in WEB_FILES:
            return self.serve_web(route)
        if route == "/space":
            found = self.space()
            if found:
                self.send_json(HTTPStatus.OK, self.info(*found)[1])
            return
        name = self.target()
        if name is None:
            return self.fail(HTTPStatus.NOT_FOUND, "not-found", "没有这个接口")
        found = self.space()
        if not found:
            return
        sid, directory = found
        if name == "":
            files, info = self.info(sid, directory)
            return self.send_json(HTTPStatus.OK, {"files": files, **info})
        if name is False:
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-name", "文件名不合法")
        try:
            f = open(os.path.join(directory, name), "rb")
        except (FileNotFoundError, IsADirectoryError):
            return self.fail(HTTPStatus.NOT_FOUND, "no-file", "文件不存在")
        with f:
            size = os.fstat(f.fileno()).st_size
            mtime = os.fstat(f.fileno()).st_mtime
            # 只有图片、音视频保留真实类型（dsh 插件据此决定能否预览）；?inline=1 时文本类按纯文本显示；其余都是下载
            query = self.query()
            guessed = mimetypes.guess_type(name)[0] or ""
            safe = bool(INLINE_TYPES.match(guessed)) and "download" not in query
            content_type = guessed if safe else "application/octet-stream"
            inline = "inline" in query and safe
            if "inline" in query and not safe and "download" not in query and TEXT_EXTENSIONS.search(name):
                content_type, inline = "text/plain; charset=utf-8", True
            # 单段 Range：手机浏览器播放视频要用
            start, end = 0, size - 1
            ranged = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
            if ranged and size > 0 and (ranged.group(1) or ranged.group(2)):
                if ranged.group(1):
                    start = int(ranged.group(1))
                    end = min(int(ranged.group(2)), size - 1) if ranged.group(2) else size - 1
                else:
                    start = max(size - int(ranged.group(2)), 0)
                if start > end or start >= size:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
            else:
                ranged = None
            self.send_response(HTTPStatus.PARTIAL_CONTENT if ranged else HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(end - start + 1))
            if ranged:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", formatdate(mtime, usegmt=True))
            self.send_header("Content-Disposition", f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(name)}")
            self.send_header("Content-Security-Policy", FILE_CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "private, no-cache")
            self.end_headers()
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0 and (chunk := f.read(min(CHUNK, remaining))):
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_PUT(self):
        name = self.target()
        if name is None:
            return self.fail(HTTPStatus.NOT_FOUND, "not-found", "没有这个接口")
        found = self.space()
        if not found:
            return
        sid, directory = found
        if not name:
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-name", "文件名不合法")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.fail(HTTPStatus.LENGTH_REQUIRED, "no-length", "缺少 Content-Length")
        if length < 0:
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-length", "Content-Length 不合法")
        if length > min(MAX_FILE, MAX_SPACE):
            return self.fail(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too-large", f"单个文件不能超过 {min(MAX_FILE, MAX_SPACE) // MB} MB")
        with lock:
            pending = sum(reserved.values())
            if scan(directory)[1] + reserved.get(sid, 0) + length > MAX_SPACE:
                return self.fail(HTTPStatus.INSUFFICIENT_STORAGE, "space-full", "这个空间满了")
            if total_used() + pending + length > MAX_TOTAL:
                return self.fail(HTTPStatus.INSUFFICIENT_STORAGE, "server-full", "服务器空间满了")
            reserved[sid] = reserved.get(sid, 0) + length
        temp = os.path.join(directory, TEMP_PREFIX + secrets.token_hex(8))
        try:
            remaining = length
            with open(temp, "wb") as out:
                while remaining > 0:
                    chunk = self.rfile.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    out.write(chunk)
                    remaining -= len(chunk)
            if remaining > 0:
                self.close_connection = True
                return  # 对方中途断开了，没法回话
            final = claim_name(directory, name)
            if final is None:
                return self.fail(HTTPStatus.CONFLICT, "name-taken", "重名的文件太多了，换个名字吧")
            os.replace(temp, os.path.join(directory, final))
            self.send_json(HTTPStatus.CREATED, {"name": final})
        except FileNotFoundError:
            # 上传途中空间被解散了
            self.fail(HTTPStatus.NOT_FOUND, "no-space", "空间已经解散了")
        finally:
            with lock:
                reserved[sid] -= length
                if reserved[sid] <= 0:
                    del reserved[sid]
            if os.path.exists(temp):
                os.unlink(temp)

    def do_DELETE(self):
        if self.route() == "/session":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.set_cookie("", 0)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.route() == "/space":
            return self.dissolve()
        name = self.target()
        if name is None:
            return self.fail(HTTPStatus.NOT_FOUND, "not-found", "没有这个接口")
        found = self.space()
        if not found:
            return
        if not name:
            return self.fail(HTTPStatus.BAD_REQUEST, "bad-name", "文件名不合法")
        try:
            os.unlink(os.path.join(found[1], name))
        except FileNotFoundError:
            return self.fail(HTTPStatus.NOT_FOUND, "no-file", "文件不存在")
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def dissolve(self):
        found = self.space()
        if not found:
            return
        sid, directory = found
        meta_path = os.path.join(SPACES, sid + ".json")
        with open(meta_path) as f:
            expected = json.load(f).get("ownerKeyHash", "")
        given = hashlib.sha256(self.headers.get("X-Owner-Key", "").encode()).hexdigest()
        if not hmac.compare_digest(given, expected):
            return self.fail(HTTPStatus.FORBIDDEN, "not-owner", "只有创建者能解散空间")
        # 先改名再删，别人看到的空间立刻消失
        trash = os.path.join(SPACES, ".trash-" + secrets.token_hex(8))
        os.rename(directory, trash)
        os.unlink(meta_path)
        shutil.rmtree(trash, ignore_errors=True)
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    if len(CREATE_CODE) < 8:
        sys.exit("SHARE_CREATE_CODE 没设置或太短（至少 8 个字符）")
    os.makedirs(SPACES, exist_ok=True)
    # 清掉上次异常退出留下的临时文件和没删完的空间
    for entry in os.scandir(SPACES):
        if entry.name.startswith(".trash-"):
            shutil.rmtree(entry.path, ignore_errors=True)
        elif entry.is_dir():
            for inner in os.listdir(entry.path):
                if inner.startswith(TEMP_PREFIX):
                    os.unlink(os.path.join(entry.path, inner))
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    server.daemon_threads = True
    print(f"share-space: {SPACES} on {BIND}:{PORT}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
