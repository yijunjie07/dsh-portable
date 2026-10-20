// 共享空间的浏览器端：左侧栏加一个「共享空间」入口。
// 还没加入时显示「加入 / 创建」：输入别人给的口令加入，或者用创建码建一个新空间；同一时间只在一个空间里。
// 加入后是文件列表，可以上传、查看、下载、删除，也能复制口令、退出空间，创建者还能解散空间。
// 手写的 dsh 客户端模块（dsh 的模块加载器格式），不需要构建。请求都发到同源的 share-space/…，
// 由主机端（index.js）转发到公网服务器。
window.__ModuleLoader__.load({
	id: "dsh-portable-share-space",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const ui = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = react.createElement;

		const NS = "shareSpace";
		const PANEL_ID = "share-space";
		const zh = {
			"panel": "共享空间",
			"title": "共享空间",
			"loading": "正在加载…",
			"retry": "重试",
			"networkError": "网络错误",
			"tab.join": "加入空间",
			"tab.create": "创建空间",
			"join.intro": "输入别人告诉你的空间口令，就能和他们共用一个文件空间。",
			"create.intro": "自己定一个口令，建好后把口令告诉谁，谁就能加入。创建码找服务器主人要。",
			"field.passphrase": "空间口令",
			"field.passphraseHint": "至少 8 个字符",
			"field.createCode": "创建码",
			"join.submit": "加入",
			"create.submit": "创建",
			"show": "显示",
			"hide": "隐藏",
			"tooShort": "口令至少 8 个字符",
			"upload": "上传",
			"refresh": "刷新",
			"summary": "{count} 个文件 · 已用 {used} / {quota}",
			"copy": "复制口令",
			"copied": "已复制",
			"leave": "退出空间",
			"leaveConfirm": "退出这个空间？空间和文件都还在，以后用口令还能再加入。",
			"dissolve": "解散空间",
			"dissolveConfirm": "解散这个空间？里面所有人的文件都会删掉，不能恢复。",
			"gone": "这个空间已经被创建者解散了。",
			"empty": "还没有文件。点「上传」或者把文件拖到这里。",
			"drop": "松开鼠标上传",
			"download": "下载",
			"delete": "删除",
			"deleteConfirm": "删除「{name}」？所有人都会看不到它，不能恢复。",
			"uploading": "上传中 {percent}%",
			"forwarding": "正在传到服务器…",
			"uploadFailed": "上传失败：{message}",
			"tooLarge": "超过单个文件上限 {max}",
			"renamed": "已重名，保存为「{name}」",
			"dismiss": "关闭"
		};
		const en = {
			"panel": "Shared space",
			"title": "Shared space",
			"loading": "Loading…",
			"retry": "Retry",
			"networkError": "Network error",
			"tab.join": "Join a space",
			"tab.create": "Create a space",
			"join.intro": "Enter the passphrase someone gave you to share their file space.",
			"create.intro": "Pick a passphrase; whoever you tell it to can join. Ask the server owner for a creation code.",
			"field.passphrase": "Passphrase",
			"field.passphraseHint": "At least 8 characters",
			"field.createCode": "Creation code",
			"join.submit": "Join",
			"create.submit": "Create",
			"show": "Show",
			"hide": "Hide",
			"tooShort": "The passphrase needs at least 8 characters",
			"upload": "Upload",
			"refresh": "Refresh",
			"summary": "{count} files · {used} of {quota} used",
			"copy": "Copy passphrase",
			"copied": "Copied",
			"leave": "Leave space",
			"leaveConfirm": "Leave this space? It keeps its files, and you can rejoin with the passphrase.",
			"dissolve": "Dissolve space",
			"dissolveConfirm": "Dissolve this space? Everyone's files in it are deleted for good.",
			"gone": "The creator has dissolved this space.",
			"empty": "No files yet. Click Upload or drop files here.",
			"drop": "Drop to upload",
			"download": "Download",
			"delete": "Delete",
			"deleteConfirm": "Delete \"{name}\"? It is removed for everyone and cannot be restored.",
			"uploading": "Uploading {percent}%",
			"forwarding": "Sending to the server…",
			"uploadFailed": "Upload failed: {message}",
			"tooLarge": "Larger than the {max} per-file limit",
			"renamed": "Name taken, saved as \"{name}\"",
			"dismiss": "Dismiss"
		};

		const css = ".ssp-page{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;flex-direction:column;overflow:hidden;position:relative}.ssp-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}.ssp-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}.ssp-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;margin-bottom:8px;padding-top:28px}[data-platform=darwin] .ssp-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}.ssp-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}.ssp-actions{display:flex;align-items:center;gap:8px}.ssp-bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px 16px;margin-bottom:16px;min-height:28px}.ssp-summary{color:var(--dsw-alias-label-tertiary);font-size:13px}.ssp-space-actions{display:flex;flex-wrap:wrap;gap:2px}.ssp-link{border:0;background:0 0;padding:2px 8px;border-radius:8px;font:inherit;font-size:13px;color:var(--dsw-alias-label-tertiary);cursor:pointer}.ssp-link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ssp-link.ssp-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.ssp-link:disabled{opacity:.4;cursor:default}.ssp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}.ssp-row{display:flex;align-items:center;gap:12px;padding:8px;border-radius:12px}.ssp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.ssp-icon{flex:none;display:flex;width:28px;justify-content:center;color:var(--dsw-alias-label-secondary)}.ssp-main{flex:1;min-width:0}.ssp-name{display:block;color:var(--dsw-alias-label-primary);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}a.ssp-name:hover{text-decoration:underline}.ssp-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}.ssp-error{color:var(--dsw-alias-state-error-primary)}.ssp-row-actions{flex:none;display:flex;gap:4px;opacity:0;transition:opacity .15s}.ssp-row:hover .ssp-row-actions,.ssp-row:focus-within .ssp-row-actions,.ssp-row-actions.ssp-shown{opacity:1}.ssp-icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;text-decoration:none}.ssp-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ssp-icon-button.ssp-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.ssp-icon-button:disabled{opacity:.4;cursor:default}.ssp-progress{height:3px;margin-top:4px;border-radius:2px;background:var(--dsw-alias-border-l3);overflow:hidden}.ssp-progress>div{height:100%;background:var(--dsw-alias-state-business-primary);transition:width .2s}.ssp-message{padding:32px 8px;color:var(--dsw-alias-label-tertiary);text-align:center}.ssp-message.ssp-error{color:var(--dsw-alias-state-error-primary)}.ssp-message button{margin-top:12px}.ssp-drop{position:absolute;inset:12px;border:2px dashed var(--dsw-alias-state-business-primary);border-radius:16px;background:var(--dsw-alias-bg-layer-1);opacity:.92;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--dsw-alias-state-business-primary);pointer-events:none}.ssp-spin{display:inline-flex;animation:ssp-spin 1s linear infinite}@keyframes ssp-spin{to{transform:rotate(360deg)}}.ssp-card{max-width:440px;margin:24px auto 0;padding:24px;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}.ssp-tabs{display:flex;gap:8px;margin-bottom:16px}.ssp-tab{height:28px;padding:0 12px;border:0;border-radius:14px;background:0 0;font:inherit;font-size:14px;color:var(--dsw-alias-label-tertiary);cursor:pointer}.ssp-tab:hover,.ssp-tab.ssp-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ssp-intro{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:13px}.ssp-field{display:block;margin-bottom:14px}.ssp-field>span{display:block;margin-bottom:4px;font-size:13px;color:var(--dsw-alias-label-secondary)}.ssp-input{display:flex;align-items:center;height:36px;padding:0 4px 0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);transition:border-color .15s}.ssp-input:focus-within{border-color:var(--dsw-alias-state-business-primary)}.ssp-input input{flex:1;min-width:0;height:100%;border:0;background:0 0;font:inherit;color:var(--dsw-alias-label-primary);outline:none}.ssp-input input::placeholder{color:var(--dsw-alias-label-caption)}.ssp-form-error{margin:-4px 0 12px;font-size:13px;color:var(--dsw-alias-state-error-primary)}.ssp-submit{display:flex;justify-content:flex-end}";
		const tagId = "dsh-portable-share-space/page.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-portable-share-space";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// 文档相对地址：dsh 挂在子路径下也能用
		const SPACE_API = "share-space/api/space/";
		const FILES_API = "share-space/api/files";
		const fileUrl = (name, download) => "share-space/files/" + encodeURIComponent(name) + (download ? "?download=1" : "");

		async function errorMessage(response) {
			try {
				const body = await response.json();
				if (typeof body.message === "string") return body.message;
			} catch {}
			return "HTTP " + response.status;
		}

		async function postSpace(action, body) {
			const response = await fetch(SPACE_API + action, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
			if (!response.ok) throw new Error(await errorMessage(response));
		}

		function upload(file, onProgress) {
			return new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open("PUT", FILES_API + "/" + encodeURIComponent(file.name));
				xhr.upload.onprogress = (event) => {
					if (event.lengthComputable) onProgress(event.loaded / event.total);
				};
				xhr.onload = () => {
					let body = {};
					try {
						body = JSON.parse(xhr.responseText);
					} catch {}
					if (xhr.status === 201) resolve(body.name);
					else reject(new Error(typeof body.message === "string" ? body.message : "HTTP " + xhr.status));
				};
				xhr.onerror = () => reject(new Error(""));
				xhr.send(file);
			});
		}

		function SecretInput({ value, onChange, placeholder, autoFocus, t }) {
			const [shown, setShown] = react.useState(false);
			return h("div", { className: "ssp-input" },
				h("input", { type: shown ? "text" : "password", value, placeholder, autoFocus, autoComplete: "off", spellCheck: false, onChange: (event) => onChange(event.target.value) }),
				h("button", { type: "button", className: "ssp-link", onClick: () => setShown(!shown) }, t(shown ? "hide" : "show")));
		}

		// 还没加入空间：加入 / 创建
		function JoinView({ t, onJoined }) {
			const [mode, setMode] = react.useState("join");
			const [passphrase, setPassphrase] = react.useState("");
			const [createCode, setCreateCode] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const submit = async (event) => {
				event.preventDefault();
				if ([...passphrase].length < 8) return setError(t("tooShort"));
				setBusy(true);
				setError(null);
				try {
					await postSpace(mode, mode === "create" ? { passphrase, createCode } : { passphrase });
					onJoined();
				} catch (failure) {
					setError(failure.message || t("networkError"));
					setBusy(false);
				}
			};
			const tab = (id) => h("button", { type: "button", className: "ssp-tab" + (mode === id ? " ssp-active" : ""), onClick: () => {
				setMode(id);
				setError(null);
			} }, t("tab." + id));
			return h("form", { className: "ssp-card", onSubmit: submit },
				h("div", { className: "ssp-tabs" }, tab("join"), tab("create")),
				h("p", { className: "ssp-intro" }, t(mode + ".intro")),
				h("label", { className: "ssp-field" },
					h("span", null, t("field.passphrase")),
					h(SecretInput, { value: passphrase, onChange: setPassphrase, placeholder: t("field.passphraseHint"), autoFocus: true, t })),
				mode === "create" ? h("label", { className: "ssp-field" },
					h("span", null, t("field.createCode")),
					h(SecretInput, { value: createCode, onChange: setCreateCode, t })) : null,
				error ? h("div", { className: "ssp-form-error" }, error) : null,
				h("div", { className: "ssp-submit" },
					h(ui.Button, { variant: "primary", size: "sm", type: "submit", disabled: busy || passphrase === "" || (mode === "create" && createCode === "") }, t(mode + ".submit"))));
		}

		let uploadSeq = 0;

		// 已加入空间：文件列表
		function FilesView({ t, space, onLeft }) {
			const [state, setState] = react.useState({ status: "loading" });
			const [uploads, setUploads] = react.useState([]);
			const [deleting, setDeleting] = react.useState(null);
			const [dragging, setDragging] = react.useState(false);
			const [copied, setCopied] = react.useState(false);
			const [leaving, setLeaving] = react.useState(false);
			const inputRef = react.useRef(null);
			const dragDepth = react.useRef(0);
			// t 每次渲染可能是新函数，load 不依赖它，免得 effect 反复触发
			const tRef = react.useRef(t);
			tRef.current = t;

			const load = react.useCallback(async () => {
				try {
					const response = await fetch(FILES_API, { cache: "no-store" });
					if (!response.ok) throw new Error(await errorMessage(response));
					setState({ status: "ready", ...(await response.json()) });
				} catch (error) {
					setState((previous) => ({ ...previous, status: "error", error: error.message || tRef.current("networkError") }));
				}
			}, []);

			react.useEffect(() => {
				load();
				// 回到这个页面时顺便刷新，别人刚传的文件也能看到
				const onFocus = () => load();
				window.addEventListener("focus", onFocus);
				return () => window.removeEventListener("focus", onFocus);
			}, [load]);

			const patchUpload = (id, patch) => setUploads((list) => list.map((item) => item.id === id ? { ...item, ...patch } : item));
			const dismissUpload = (id) => setUploads((list) => list.filter((item) => item.id !== id));

			const startUploads = (fileList) => {
				for (const file of Array.from(fileList)) {
					const id = ++uploadSeq;
					const max = state.maxFileBytes;
					if (max !== undefined && file.size > max) {
						setUploads((list) => [...list, { id, name: file.name, error: t("tooLarge", { max: ui.fileSizeText(max) }) }]);
						continue;
					}
					setUploads((list) => [...list, { id, name: file.name, progress: 0 }]);
					upload(file, (progress) => patchUpload(id, { progress })).then((saved) => {
						if (saved && saved !== file.name) patchUpload(id, { done: true, note: t("renamed", { name: saved }) });
						else dismissUpload(id);
						load();
					}, (error) => {
						patchUpload(id, { error: t("uploadFailed", { message: error.message || t("networkError") }) });
					});
				}
			};

			const remove = async (name) => {
				if (!window.confirm(t("deleteConfirm", { name }))) return;
				setDeleting(name);
				try {
					const response = await fetch(FILES_API + "/" + encodeURIComponent(name), { method: "DELETE" });
					if (!response.ok && response.status !== 404) window.alert(await errorMessage(response));
				} catch {
					window.alert(t("networkError"));
				}
				setDeleting(null);
				load();
			};

			const spaceAction = async (action, confirmKey) => {
				if (!window.confirm(t(confirmKey))) return;
				setLeaving(true);
				try {
					await postSpace(action);
					onLeft();
				} catch (error) {
					window.alert(error.message || t("networkError"));
					setLeaving(false);
				}
			};

			const copy = async () => {
				try {
					await navigator.clipboard.writeText(space.passphrase);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					window.prompt(t("copy"), space.passphrase);
				}
			};

			const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
			const dropHandlers = {
				onDragEnter: (event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					dragDepth.current += 1;
					setDragging(true);
				},
				onDragOver: (event) => {
					if (hasFiles(event)) event.preventDefault();
				},
				onDragLeave: (event) => {
					if (!hasFiles(event)) return;
					dragDepth.current -= 1;
					if (dragDepth.current <= 0) setDragging(false);
				},
				onDrop: (event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					dragDepth.current = 0;
					setDragging(false);
					startUploads(event.dataTransfer.files);
				}
			};

			const files = state.files ?? [];
			let body;
			if (state.status === "error" && state.files === undefined) {
				body = h("div", { className: "ssp-message ssp-error" }, h("div", null, state.error), h(ui.Button, { variant: "outline", size: "sm", onClick: load }, t("retry")));
			} else if (state.status === "loading") {
				body = h("div", { className: "ssp-message" }, t("loading"));
			} else if (files.length === 0 && uploads.length === 0) {
				body = h("div", { className: "ssp-message" }, t("empty"));
			} else {
				body = h("ul", { className: "ssp-list" },
					uploads.map((item) => h("li", { key: "u" + item.id, className: "ssp-row" },
						h("span", { className: "ssp-icon" }, item.error || item.done ? h(ui.FileTypeIcon, { path: item.name, size: 20 }) : h("span", { className: "ssp-spin" }, h(ui.IconLoadingOutlineRegular, { size: 16 }))),
						h("div", { className: "ssp-main" },
							h("span", { className: "ssp-name" }, item.name),
							item.error
								? h("div", { className: "ssp-meta ssp-error" }, item.error)
								: item.done
									? h("div", { className: "ssp-meta" }, item.note)
									: h(react.Fragment, null,
										// 浏览器到本机 dsh 很快就到 100%，之后还要等 dsh 转发到服务器
										h("div", { className: "ssp-meta" }, item.progress >= 1 ? t("forwarding") : t("uploading", { percent: Math.floor(item.progress * 100) })),
										h("div", { className: "ssp-progress" }, h("div", { style: { width: item.progress * 100 + "%" } })))),
						item.error || item.done ? h("div", { className: "ssp-row-actions ssp-shown" },
							h("button", { type: "button", className: "ssp-icon-button", title: t("dismiss"), "aria-label": t("dismiss"), onClick: () => dismissUpload(item.id) }, "×")) : null)),
					files.map((file) => h("li", { key: file.name, className: "ssp-row" },
						h("span", { className: "ssp-icon" }, h(ui.FileTypeIcon, { path: file.name, size: 20 })),
						h("div", { className: "ssp-main" },
							h("a", { className: "ssp-name", href: fileUrl(file.name, false), target: "_blank", rel: "noopener noreferrer", title: file.name }, file.name),
							h("div", { className: "ssp-meta" }, ui.fileSizeText(file.size) + " · " + new Date(file.mtime).toLocaleString())),
						h("div", { className: "ssp-row-actions" },
							h("a", { className: "ssp-icon-button", href: fileUrl(file.name, true), download: file.name, title: t("download"), "aria-label": t("download") }, h(ui.IconDownloadOutlineRegular, { size: 16 })),
							h("button", { type: "button", className: "ssp-icon-button ssp-danger", title: t("delete"), "aria-label": t("delete"), disabled: deleting === file.name, onClick: () => remove(file.name) }, h(ui.IconTrashOutlineRegular, { size: 16 }))))));
			}

			return h("section", { className: "ssp-page", "aria-label": t("title"), ...dropHandlers },
				h("div", { className: "ssp-scroll" },
					h("div", { className: "ssp-content" },
						h("div", { className: "ssp-heading" },
							h("h1", null, t("title")),
							h("div", { className: "ssp-actions" },
								h(ui.Button, { variant: "ghost", size: "sm", icon: h(ui.IconRefreshOutlineRegular, { size: 14 }), onClick: load }, t("refresh")),
								h(ui.Button, { variant: "primary", size: "sm", icon: h(ui.IconPlusOutlineRegular, { size: 13 }), onClick: () => inputRef.current?.click() }, t("upload")),
								h("input", {
									ref: inputRef,
									type: "file",
									multiple: true,
									hidden: true,
									onChange: (event) => {
										startUploads(event.target.files);
										event.target.value = "";
									}
								}))),
						h("div", { className: "ssp-bar" },
							h("div", { className: "ssp-summary" },
								state.usedBytes !== undefined ? t("summary", { count: files.length, used: ui.fileSizeText(state.usedBytes), quota: ui.fileSizeText(state.quotaBytes) }) : null,
								state.status === "error" && state.files !== undefined ? h("span", { className: "ssp-error" }, " · " + state.error) : null),
							h("div", { className: "ssp-space-actions" },
								h("button", { type: "button", className: "ssp-link", onClick: copy }, t(copied ? "copied" : "copy")),
								h("button", { type: "button", className: "ssp-link", disabled: leaving, onClick: () => spaceAction("leave", "leaveConfirm") }, t("leave")),
								space.owner ? h("button", { type: "button", className: "ssp-link ssp-danger", disabled: leaving, onClick: () => spaceAction("dissolve", "dissolveConfirm") }, t("dissolve")) : null)),
						body)),
				dragging ? h("div", { className: "ssp-drop" }, t("drop")) : null);
		}

		function ShareSpacePage({ t }) {
			const [space, setSpace] = react.useState({ status: "loading" });
			const load = react.useCallback(async () => {
				setSpace({ status: "loading" });
				try {
					const response = await fetch(SPACE_API + "state", { cache: "no-store" });
					if (!response.ok) throw new Error(await errorMessage(response));
					setSpace({ status: "ready", ...(await response.json()) });
				} catch (error) {
					setSpace({ status: "error", error: error.message });
				}
			}, []);
			react.useEffect(() => {
				load();
			}, [load]);

			const shell = (children) => h("section", { className: "ssp-page", "aria-label": t("title") },
				h("div", { className: "ssp-scroll" },
					h("div", { className: "ssp-content" },
						h("div", { className: "ssp-heading" }, h("h1", null, t("title"))),
						children)));

			if (space.status === "loading") return shell(h("div", { className: "ssp-message" }, t("loading")));
			if (space.status === "error") return shell(h("div", { className: "ssp-message ssp-error" }, h("div", null, space.error || t("networkError")), h(ui.Button, { variant: "outline", size: "sm", onClick: load }, t("retry"))));
			if (!space.joined) return shell(h(JoinView, { t, onJoined: load }));
			if (space.gone) {
				const leave = async () => {
					try {
						await postSpace("leave");
					} catch {}
					load();
				};
				return shell(h("div", { className: "ssp-message" }, h("div", null, t("gone")), h(ui.Button, { variant: "outline", size: "sm", onClick: leave }, t("leave"))));
			}
			return h(FilesView, { t, space, onLeft: load });
		}

		function ShareSpaceIcon({ size }) {
			return h(ui.IconFolderOpenOutlineRegular, { size });
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "share-space: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS
			}, ShareSpacePage));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 20,
				locale: NS,
				label: () => t("panel")
			}, ShareSpaceIcon));
		}

		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
