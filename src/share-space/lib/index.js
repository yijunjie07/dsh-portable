// 共享空间的主机端：在 dsh 的 Web 服务器上挂 /share-space/，把请求转发给公网上的共享空间服务。
// 每份 dsh 同一时间只在一个空间里：页面上输入口令创建或加入，口令记在 U 盘的 home/share-space.json，
// 换电脑也还在这个空间里：
//   { "passphrase": "…", "ownerKey": "…（只有创建者有，用来解散空间）" }
//
// 浏览器只访问同源的 /share-space/...，由本机进程带上口令转发；页面能看到口令（方便复制给别人），但口令不会发给别的网站。
// 每个请求先过 dsh 自己的 connection 检查（Host/Origin 防 DNS rebinding 和跨站调用，外加登录 cookie）。
// 别人上传的文件在 dsh 的源下打开：一律 CSP sandbox + nosniff，免得它借 dsh 的源调用 dsh 的接口。
// 只有图片、音视频直接显示；代码和文本类（包括 HTML）按纯文本显示源码；其余（包括 SVG）一律下载。
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import z from "@deepseek-ai/schemastery";

export const name = "share-space";
export const inject = ["webServer", "connection"];
export const Config = z.object({
  url: z.string().required(),
  configFile: z.string().required(),
});

const PREFIX = "/share-space";
const MAX_BODY_BYTES = 16 * 1024;
const MIN_PASSPHRASE = 8;
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+|video\/[\w.+-]+)$/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|xml|c|h|cc|cpp|hpp|py|js|mjs|ts|tsx|jsx|java|go|rs|rb|sh|bat|ps1|sql|css|scss|html?|vue|kt|swift|lua)$/i;
const SANDBOX = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

// 当前加入的空间；文件不存在或格式不对都当作没加入
async function loadMembership(file) {
  try {
    const { passphrase, ownerKey } = JSON.parse(await readFile(file, "utf8"));
    if (typeof passphrase === "string" && passphrase !== "") {
      return { passphrase, ownerKey: typeof ownerKey === "string" ? ownerKey : undefined };
    }
  } catch {}
  return undefined;
}

async function saveMembership(file, membership) {
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(membership, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, file);
}

const bearer = (passphrase) => `Bearer ${Buffer.from(passphrase, "utf8").toString("base64url")}`;

// 发一个上游请求，拿到响应头就返回；body 是可选的可读流或 Buffer
function upstream(base, method, path, headers, body) {
  const url = new URL(base.replace(/\/+$/, "") + path);
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, headers, timeout: 30_000 }, resolve);
    req.on("timeout", () => req.destroy(new Error("连接共享空间服务器超时")));
    req.on("error", reject);
    if (body === undefined) {
      req.end();
    } else if (Buffer.isBuffer(body)) {
      req.end(body);
    } else {
      body.on("error", (error) => req.destroy(error));
      body.pipe(req);
    }
  });
}

async function readJson(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const failure = (status, payload) => ({ code: payload.code, message: payload.message ?? `共享空间服务器返回 ${status}` });

// 把上游的 JSON 或错误交给浏览器（错误统一带 message）
async function relayJson(res, response) {
  if (response.statusCode === 204) {
    response.resume();
    res.statusCode = 204;
    res.end();
    return;
  }
  const payload = await readJson(response);
  sendJson(res, response.statusCode, response.statusCode >= 400 ? { ...payload, ...failure(response.statusCode, payload) } : payload);
}

// 浏览器发来的小 JSON 请求体；格式不对返回 undefined
async function readBody(req) {
  if (String(req.headers["content-type"]).split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    req.resume();
    return undefined;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof body === "object" && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
}

function fileHeaders(res, name, upstreamType, download) {
  let type = upstreamType.split(";", 1)[0].trim().toLowerCase();
  let inline = !download && INLINE_TYPES.test(type);
  if (!download && !inline && TEXT_EXTENSIONS.test(name)) {
    type = "text/plain; charset=utf-8";
    inline = true;
  }
  res.setHeader("content-type", inline ? type : "application/octet-stream");
  res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader("content-security-policy", SANDBOX);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
}

export function apply(ctx, config) {
  const rejected = (req, res) => {
    const rejection = Reflect.get(ctx, "connection").requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  // 当前状态、创建、加入、退出、解散：/share-space/api/space/<动作>
  async function spaceAction(action, req, res) {
    const membership = await loadMembership(config.configFile);
    if (action === "state") {
      if (req.method !== "GET") return sendJson(res, 405, { message: "只支持 GET" });
      if (membership === undefined) return sendJson(res, 200, { joined: false });
      const response = await upstream(config.url, "GET", "/space", { authorization: bearer(membership.passphrase) });
      const payload = await readJson(response);
      const joined = { joined: true, owner: membership.ownerKey !== undefined, passphrase: membership.passphrase };
      if (response.statusCode === 200) return sendJson(res, 200, { ...joined, ...payload });
      // 空间已经被解散了：告诉页面，让用户自己点退出
      if (response.statusCode === 404 && payload.code === "no-space") return sendJson(res, 200, { ...joined, gone: true });
      return sendJson(res, response.statusCode, failure(response.statusCode, payload));
    }
    if (req.method !== "POST") return sendJson(res, 405, { message: "只支持 POST" });
    const body = await readBody(req);
    if (body === undefined) return sendJson(res, 400, { message: "请求格式不对" });

    if (action === "create" || action === "join") {
      if (membership !== undefined) return sendJson(res, 409, { code: "already-joined", message: "已经在一个空间里了，先退出" });
      const passphrase = typeof body.passphrase === "string" ? body.passphrase.normalize("NFC") : "";
      if ([...passphrase].length < MIN_PASSPHRASE) return sendJson(res, 400, { message: `口令至少 ${MIN_PASSPHRASE} 个字符` });
      if (action === "create") {
        const response = await upstream(config.url, "POST", "/spaces", {
          authorization: bearer(passphrase),
          "x-create-code": typeof body.createCode === "string" ? body.createCode.trim() : "",
          "content-length": "0",
        }, Buffer.alloc(0));
        const payload = await readJson(response);
        if (response.statusCode !== 201) return sendJson(res, response.statusCode, failure(response.statusCode, payload));
        await saveMembership(config.configFile, { passphrase, ownerKey: payload.ownerKey });
        return sendJson(res, 201, { ok: true });
      }
      const response = await upstream(config.url, "GET", "/space", { authorization: bearer(passphrase) });
      const payload = await readJson(response);
      if (response.statusCode !== 200) return sendJson(res, response.statusCode, failure(response.statusCode, payload));
      await saveMembership(config.configFile, { passphrase });
      return sendJson(res, 200, { ok: true });
    }

    if (membership === undefined) return sendJson(res, 409, { code: "not-joined", message: "还没加入空间" });
    if (action === "leave") {
      await rm(config.configFile, { force: true });
      return sendJson(res, 200, { ok: true });
    }
    if (action === "dissolve") {
      if (membership.ownerKey === undefined) return sendJson(res, 403, { message: "只有创建者能解散空间" });
      const response = await upstream(config.url, "DELETE", "/space", {
        authorization: bearer(membership.passphrase),
        "x-owner-key": membership.ownerKey,
      });
      if (response.statusCode !== 204 && response.statusCode !== 404) return relayJson(res, response);
      response.resume();
      await rm(config.configFile, { force: true });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { message: "没有这个接口" });
  }

  // 文件列表、上传、删除、查看、下载，都在当前空间里
  async function fileAction(rest, url, req, res) {
    // 文件名只占一段路径（斜杠已编码成 %2F）
    const tail = rest.replace(/^\/(api\/)?files\/?/, "");
    if (tail.includes("/")) {
      req.resume();
      return sendJson(res, 400, { message: "文件名不合法" });
    }
    const membership = await loadMembership(config.configFile);
    if (membership === undefined) {
      req.resume();
      return sendJson(res, 409, { code: "not-joined", message: "还没加入空间" });
    }
    const auth = { authorization: bearer(membership.passphrase) };
    if (rest === "/api/files") {
      if (req.method !== "GET") return sendJson(res, 405, { message: "只支持 GET" });
      return relayJson(res, await upstream(config.url, "GET", "/files", auth));
    }
    if (rest.startsWith("/api/files/")) {
      if (req.method === "PUT") {
        const length = req.headers["content-length"];
        if (length === undefined) return sendJson(res, 411, { message: "缺少 Content-Length" });
        return relayJson(res, await upstream(config.url, "PUT", "/files/" + tail, {
          ...auth,
          "content-length": length,
          "content-type": "application/octet-stream",
        }, req));
      }
      if (req.method === "DELETE") return relayJson(res, await upstream(config.url, "DELETE", "/files/" + tail, auth));
      return sendJson(res, 405, { message: "只支持 PUT 和 DELETE" });
    }
    // 查看、下载：/share-space/files/<名字>[?download=1]
    if (rest.startsWith("/files/")) {
      if (req.method !== "GET") return sendJson(res, 405, { message: "只支持 GET" });
      let name;
      try {
        name = decodeURIComponent(tail);
      } catch {
        return sendJson(res, 400, { message: "文件名不合法" });
      }
      const response = await upstream(config.url, "GET", "/files/" + tail, auth);
      if (response.statusCode !== 200) return relayJson(res, response);
      res.statusCode = 200;
      fileHeaders(res, name, String(response.headers["content-type"] ?? ""), url.searchParams.has("download"));
      for (const header of ["content-length", "last-modified"]) {
        if (response.headers[header] !== undefined) res.setHeader(header, response.headers[header]);
      }
      response.on("error", () => res.destroy());
      response.pipe(res);
      return;
    }
    sendJson(res, 404, { message: "没有这个接口" });
  }

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: async (req, res) => {
      if (rejected(req, res)) return;
      const url = new URL(String(req.url), "http://localhost");
      const rest = url.pathname.slice(PREFIX.length);
      try {
        if (rest.startsWith("/api/space/")) await spaceAction(rest.slice("/api/space/".length), req, res);
        else await fileAction(rest, url, req, res);
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        sendJson(res, 502, { message: `连不上共享空间服务器：${error.message}` });
      }
    },
  }), `share-space: ${PREFIX}/*`);
}
