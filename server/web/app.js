// 共享空间网页版：手机、电脑浏览器都能用，和 dsh 插件共用同一套空间。
// 口令验证后服务器发一个 HttpOnly cookie，之后的请求和图片、下载链接都靠它；
// 口令和创建者的解散钥匙另外记在这台设备的 localStorage 里（复制口令、解散空间要用）。
// 所有文件名都用 textContent 放进页面，不拼 HTML。
"use strict";

const STORE_KEY = "shareSpace";
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i;
const TEXT_EXT = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|xml|c|h|cc|cpp|hpp|py|js|mjs|ts|tsx|jsx|java|go|rs|rb|sh|bat|ps1|sql|css|scss|html?|vue|kt|swift|lua)$/i;

const app = document.getElementById("app");

// ---- 小工具 ----
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "className") node.className = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  download: "M12 4v12m-5-5 5 5 5-5M4 20h16",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  close: "M6 6l12 12M18 6 6 18",
  prev: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  loading: "M12 3a9 9 0 1 0 9 9",
  open: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
};
function icon(name, size = 20, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function fileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unit];
}

function extension(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

const fileUrl = (name, mode) => "files/" + encodeURIComponent(name) + (mode ? "?" + mode + "=1" : "");
const bearer = (passphrase) => {
  const bytes = new TextEncoder().encode(passphrase);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "Bearer " + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function loadStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    return value && typeof value.passphrase === "string" ? value : null;
  } catch {
    return null;
  }
}
function saveStore(value) {
  try {
    if (value) localStorage.setItem(STORE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORE_KEY);
  } catch {}
}

async function request(method, path, { headers, body } = {}) {
  const response = await fetch(path, { method, headers, body, cache: "no-store", credentials: "same-origin" });
  let payload = {};
  if (response.status !== 204) {
    try { payload = await response.json(); } catch {}
  }
  if (!response.ok) {
    const error = new Error(payload.message || "出错了（HTTP " + response.status + "）");
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

let toastTimer;
function toast(text) {
  document.querySelector(".toast")?.remove();
  const node = el("div", { className: "toast", role: "status" }, text);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2200);
}

function render(...nodes) {
  app.replaceChildren(...nodes);
}

// ---- 启动 ----
async function start() {
  const stored = loadStore();
  if (!stored) return showJoin();
  render(el("p", { className: "message" }, "正在加载…"));
  try {
    await request("POST", "session", { headers: { authorization: bearer(stored.passphrase) } });
    showSpace(stored);
  } catch (error) {
    if (error.code === "no-space") return showGone();
    render(el("div", { className: "message error" },
      el("div", null, error.message || "网络错误"),
      el("button", { className: "btn", onclick: start }, "重试")));
  }
}

// ---- 加入 / 创建 ----
function secretInput(placeholder, autofocus) {
  const input = el("input", { type: "password", placeholder, autocomplete: "off", autocapitalize: "off", spellcheck: "false", autofocus });
  const toggle = el("button", { type: "button", className: "link", onclick: () => {
    const shown = input.type === "text";
    input.type = shown ? "password" : "text";
    toggle.textContent = shown ? "显示" : "隐藏";
  } }, "显示");
  return { input, node: el("div", { className: "input" }, input, toggle) };
}

function showJoin() {
  // 离开空间页时撤掉它挂的全局事件
  window.ondragenter = window.ondragover = window.ondragleave = window.ondrop = null;
  document.onvisibilitychange = null;
  let mode = "join";
  const passphrase = secretInput("至少 8 个字符", true);
  const createCode = secretInput("");
  const codeField = el("label", { className: "field" }, el("span", null, "创建码"), createCode.node);
  const intro = el("p", { className: "intro" });
  const error = el("div", { className: "form-error", hidden: true });
  const submit = el("button", { type: "submit", className: "btn primary" });
  const tabs = {
    join: el("button", { type: "button", className: "tab", onclick: () => setMode("join") }, "加入空间"),
    create: el("button", { type: "button", className: "tab", onclick: () => setMode("create") }, "创建空间"),
  };
  function setMode(next) {
    mode = next;
    tabs.join.classList.toggle("active", mode === "join");
    tabs.create.classList.toggle("active", mode === "create");
    codeField.hidden = mode !== "create";
    intro.textContent = mode === "join"
      ? "输入别人告诉你的空间口令，就能和他们共用一个文件空间。"
      : "自己定一个口令，建好后把口令告诉谁，谁就能加入。创建码找服务器主人要。";
    submit.textContent = mode === "join" ? "加入" : "创建";
    error.hidden = true;
  }
  setMode("join");

  const form = el("form", { className: "card", onsubmit: async (event) => {
    event.preventDefault();
    const value = passphrase.input.value.normalize("NFC");
    const fail = (text) => { error.textContent = text; error.hidden = false; };
    if ([...value].length < 8) return fail("口令至少 8 个字符");
    if (mode === "create" && createCode.input.value.trim() === "") return fail("请填创建码");
    submit.disabled = true;
    error.hidden = true;
    try {
      const auth = { authorization: bearer(value) };
      let ownerKey;
      if (mode === "create") {
        ownerKey = (await request("POST", "spaces", { headers: { ...auth, "x-create-code": createCode.input.value.trim() } })).ownerKey;
      }
      await request("POST", "session", { headers: auth });
      const stored = { passphrase: value, ...(ownerKey ? { ownerKey } : {}) };
      saveStore(stored);
      showSpace(stored);
    } catch (failure) {
      fail(failure.message || "网络错误");
      submit.disabled = false;
    }
  } },
    el("h1", null, "共享空间"),
    el("div", { className: "tabs" }, tabs.join, tabs.create),
    intro,
    el("label", { className: "field" }, el("span", null, "空间口令"), passphrase.node),
    codeField,
    error,
    submit);
  render(form);
}

function showGone() {
  render(el("div", { className: "message" },
    el("div", null, "这个空间已经被创建者解散了。"),
    el("button", { className: "btn", onclick: leave }, "退出空间")));
}

async function leave() {
  try { await request("DELETE", "session"); } catch {}
  saveStore(null);
  showJoin();
}

// ---- 空间 ----
let uploadSeq = 0;

function showSpace(stored) {
  let files = [];
  let info = {};
  const uploads = [];
  const fileInput = el("input", { type: "file", multiple: true, hidden: true, onchange: () => {
    startUploads(fileInput.files);
    fileInput.value = "";
  } });
  const summary = el("div", { className: "summary" });
  const content = el("div");

  const copyLink = el("button", { className: "link", onclick: async () => {
    try {
      await navigator.clipboard.writeText(stored.passphrase);
      toast("口令已复制，发给要加入的人");
    } catch {
      window.prompt("复制口令", stored.passphrase);
    }
  } }, "复制口令");
  const leaveLink = el("button", { className: "link", onclick: () => {
    if (confirm("退出这个空间？空间和文件都还在，以后用口令还能再加入。")) leave();
  } }, "退出");
  const dissolveLink = stored.ownerKey ? el("button", { className: "link danger", onclick: async () => {
    if (!confirm("解散这个空间？里面所有人的文件都会删掉，不能恢复。")) return;
    try {
      await request("DELETE", "space", { headers: { authorization: bearer(stored.passphrase), "x-owner-key": stored.ownerKey } });
    } catch (error) {
      if (error.code !== "no-space") return toast(error.message);
    }
    leave();
  } }, "解散") : null;

  render(
    el("div", { className: "top" },
      el("h1", null, "共享空间"),
      el("div", { className: "actions" },
        el("button", { className: "icon-btn", title: "刷新", "aria-label": "刷新", onclick: () => load() }, icon("refresh")),
        el("button", { className: "btn primary", onclick: () => fileInput.click() }, icon("upload", 18), "上传"),
        fileInput)),
    el("div", { className: "bar" }, summary, el("div", { className: "links" }, copyLink, leaveLink, dissolveLink)),
    content);

  async function load() {
    try {
      const payload = await request("GET", "files");
      files = payload.files;
      info = payload;
      draw();
    } catch (error) {
      if (error.code === "no-space") return showGone();
      if (error.status === 401) return start();
      if (files.length === 0) {
        content.replaceChildren(el("div", { className: "message error" }, el("div", null, error.message), el("button", { className: "btn", onclick: () => load() }, "重试")));
      } else {
        toast(error.message);
      }
    }
  }

  function draw() {
    summary.textContent = info.usedBytes === undefined ? "" : `${files.length} 个文件 · 已用 ${fileSize(info.usedBytes)} / ${fileSize(info.quotaBytes)}`;
    const images = files.filter((file) => IMAGE_EXT.test(file.name));
    const others = files.filter((file) => !IMAGE_EXT.test(file.name));
    const parts = [];
    if (uploads.length) parts.push(el("ul", { className: "list" }, uploads.map(uploadRow)));
    if (images.length) {
      parts.push(el("div", { className: "section-title" }, `图片 ${images.length}`));
      parts.push(el("div", { className: "grid" }, images.map((file, index) =>
        el("button", { className: "thumb", title: file.name, "aria-label": file.name, onclick: () => openViewer(images, index) },
          el("img", { src: fileUrl(file.name, "inline"), alt: "", loading: "lazy", decoding: "async" })))));
    }
    if (others.length) {
      if (images.length) parts.push(el("div", { className: "section-title" }, `其他文件 ${others.length}`));
      parts.push(el("ul", { className: "list" }, others.map(fileRow)));
    }
    if (!parts.length) parts.push(el("p", { className: "message" }, "还没有文件。点「上传」选照片或文件，电脑上也可以把文件拖进来。"));
    content.replaceChildren(...parts);
  }

  function fileRow(file) {
    const media = VIDEO_EXT.test(file.name) || AUDIO_EXT.test(file.name);
    const open = () => {
      if (media) openViewer([file], 0);
      else if (TEXT_EXT.test(file.name)) window.open(fileUrl(file.name, "inline"), "_blank", "noopener");
      else location.href = fileUrl(file.name, "download");
    };
    return el("li", { className: "row" },
      el("div", { className: "badge" }, extension(file.name)),
      el("button", { className: "main", onclick: open },
        el("span", { className: "name" }, file.name),
        el("span", { className: "meta" }, fileSize(file.size) + " · " + new Date(file.mtime).toLocaleString())),
      el("div", { className: "row-actions", style: { display: "flex" } },
        el("a", { className: "icon-btn", href: fileUrl(file.name, "download"), download: file.name, title: "下载", "aria-label": "下载" }, icon("download")),
        el("button", { className: "icon-btn danger", title: "删除", "aria-label": "删除", onclick: () => remove(file.name) }, icon("trash"))));
  }

  function uploadRow(item) {
    let status;
    if (item.error) status = el("span", { className: "meta error" }, item.error);
    else if (item.note) status = el("span", { className: "meta" }, item.note);
    else status = [el("span", { className: "meta" }, `上传中 ${Math.floor(item.progress * 100)}%`),
      el("div", { className: "progress" }, el("div", { style: { width: item.progress * 100 + "%" } }))];
    const done = item.error || item.note;
    return el("li", { className: "row" },
      el("div", { className: "badge" }, done ? extension(item.name) : icon("loading", 18, "spin")),
      el("div", { className: "main" }, el("span", { className: "name" }, item.name), status),
      done ? el("button", { className: "icon-btn", title: "关闭", "aria-label": "关闭", onclick: () => {
        uploads.splice(uploads.indexOf(item), 1);
        draw();
      } }, icon("close", 18)) : null);
  }

  function startUploads(list) {
    for (const file of Array.from(list)) {
      const item = { id: ++uploadSeq, name: file.name, progress: 0 };
      uploads.push(item);
      if (info.maxFileBytes !== undefined && file.size > info.maxFileBytes) {
        item.error = "超过单个文件上限 " + fileSize(info.maxFileBytes);
        continue;
      }
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", fileUrl(file.name));
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        item.progress = event.loaded / event.total;
        draw();
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 201) {
          if (body.name && body.name !== file.name) item.note = `已重名，保存为「${body.name}」`;
          else uploads.splice(uploads.indexOf(item), 1);
          load();
        } else {
          item.error = "上传失败：" + (body.message || "HTTP " + xhr.status);
          draw();
        }
      };
      xhr.onerror = () => {
        item.error = "上传失败：网络错误";
        draw();
      };
      xhr.send(file);
    }
    draw();
  }

  async function remove(name) {
    if (!confirm(`删除「${name}」？所有人都会看不到它，不能恢复。`)) return false;
    try {
      await request("DELETE", fileUrl(name));
    } catch (error) {
      if (error.code !== "no-file") toast(error.message);
    }
    await load();
    return true;
  }

  // 大图、视频、音频查看：左右切换，下载，删除
  function openViewer(list, index) {
    const title = el("div", { className: "viewer-title" });
    const body = el("div", { className: "viewer-body" });
    const hint = el("div", { className: "viewer-hint" });
    const download = el("a", { className: "icon-btn", title: "下载", "aria-label": "下载" }, icon("download", 22));
    const prev = el("button", { className: "icon-btn", title: "上一张", "aria-label": "上一张", onclick: () => go(-1) }, icon("prev", 22));
    const next = el("button", { className: "icon-btn", title: "下一张", "aria-label": "下一张", onclick: () => go(1) }, icon("next", 22));
    const viewer = el("div", { className: "viewer", role: "dialog", "aria-modal": "true" },
      el("div", { className: "viewer-top" },
        el("button", { className: "icon-btn", title: "关闭", "aria-label": "关闭", onclick: close }, icon("close", 22)),
        title,
        download,
        el("button", { className: "icon-btn danger", title: "删除", "aria-label": "删除", onclick: async () => {
          if (await remove(list[index].name)) close();
        } }, icon("trash", 22))),
      body,
      hint,
      el("div", { className: "viewer-bottom" }, prev, next));
    function show() {
      const file = list[index];
      title.textContent = file.name;
      download.href = fileUrl(file.name, "download");
      download.setAttribute("download", file.name);
      const src = fileUrl(file.name, "inline");
      let media;
      if (IMAGE_EXT.test(file.name)) media = el("img", { src, alt: file.name });
      else if (VIDEO_EXT.test(file.name)) media = el("video", { src, controls: true, playsInline: true, preload: "metadata" });
      else media = el("audio", { src, controls: true, preload: "metadata" });
      body.replaceChildren(media);
      hint.textContent = IMAGE_EXT.test(file.name) && /iPhone|iPad|Android/i.test(navigator.userAgent) ? "长按图片可以保存到相册" : "";
      prev.hidden = next.hidden = list.length < 2;
      prev.disabled = index === 0;
      next.disabled = index === list.length - 1;
    }
    function go(step) {
      const target = index + step;
      if (target < 0 || target >= list.length) return;
      index = target;
      show();
    }
    function onKey(event) {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    }
    // 左右滑动切换
    let touchX = null;
    body.addEventListener("touchstart", (event) => { touchX = event.touches.length === 1 ? event.touches[0].clientX : null; }, { passive: true });
    body.addEventListener("touchend", (event) => {
      if (touchX === null) return;
      const dx = event.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      touchX = null;
    });
    function close() {
      document.removeEventListener("keydown", onKey);
      viewer.remove();
      document.body.style.overflow = "";
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.append(viewer);
    show();
  }

  // 电脑上可以把文件拖进来
  let dragDepth = 0;
  let dropNode = null;
  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  window.ondragenter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (dragDepth++ === 0) document.body.append(dropNode = el("div", { className: "drop" }, "松开鼠标上传"));
  };
  window.ondragover = (event) => { if (hasFiles(event)) event.preventDefault(); };
  window.ondragleave = (event) => {
    if (hasFiles(event) && --dragDepth <= 0) { dragDepth = 0; dropNode?.remove(); }
  };
  window.ondrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropNode?.remove();
    startUploads(event.dataTransfer.files);
  };

  // 回到这个页面时刷新，别人刚传的文件也能看到
  document.onvisibilitychange = () => { if (document.visibilityState === "visible") load(); };

  content.replaceChildren(el("p", { className: "message" }, "正在加载…"));
  load();
}

start();
