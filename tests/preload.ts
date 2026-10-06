import { mock } from "bun:test";

export class FakeElement {
	children: FakeElement[] = [];
	textContent = "";
	innerHTML = "";
	style: Record<string, string> = {};
	private classes = new Set<string>();
	classList = {
		add: (...classes: string[]) => classes.forEach((cls) => this.classes.add(cls)),
		remove: (...classes: string[]) => classes.forEach((cls) => this.classes.delete(cls)),
		contains: (cls: string) => this.classes.has(cls),
	};
	createEl(
		_tag: string,
		options?: any,
		callback?: (el: FakeElement) => void
	): FakeElement {
		const el = new FakeElement();
		el.textContent = options?.text ?? "";
		this.children.push(el);
		callback?.(el);
		return el;
	}
	createSpan(options?: any, callback?: (el: FakeElement) => void) {
		return this.createEl("span", options, callback);
	}
	createDiv(options?: any, callback?: (el: FakeElement) => void) {
		return this.createEl("div", options, callback);
	}
	appendChild(child: FakeElement) {
		this.children.push(child);
		return child;
	}
	append(...children: FakeElement[]) {
		this.children.push(...children);
	}
	setText(text: string) {
		this.textContent = text;
	}
	addClass(...classes: string[]) {
		this.classList.add(...classes);
	}
	removeClass(...classes: string[]) {
		this.classList.remove(...classes);
	}
	empty() {
		this.children = [];
	}
	remove() {}
	querySelector() {
		return null;
	}
}

export class FakeTFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: any = null;
	stat = { mtime: 1, ctime: 1, size: 1 };
	constructor(path: string) {
		this.path = path;
		this.name = path.split("/").pop()!;
		this.extension = this.name.split(".").pop()!;
		this.basename = this.name.slice(0, -this.extension.length - 1);
	}
}
export class FakeTFolder {
	children: (FakeTFile | FakeTFolder)[] = [];
	constructor(
		public path: string,
		public name = path.split("/").pop()!
	) {}
}

class FakeControl {
	value: any;
	disabled = false;
	inputEl = new FakeElement();
	buttonEl = new FakeElement();
	toggleEl = new FakeElement();
	change: (value: any) => Promise<void> | void = () => {};
	click: () => Promise<void> | void = () => {};
	setValue(value: any) {
		this.value = value;
		return this;
	}
	setDisabled(value: boolean) {
		this.disabled = value;
		return this;
	}
	setPlaceholder(_value: string) {
		return this;
	}
	setTooltip(_value: string) {
		return this;
	}
	setButtonText(_value: string) {
		return this;
	}
	setIcon(_value: string) {
		return this;
	}
	setClass(_value: string) {
		return this;
	}
	setCta() {
		return this;
	}
	addOption(_key: string, _value: string) {
		return this;
	}
	addOptions(_value: any) {
		return this;
	}
	onChange(callback: typeof this.change) {
		this.change = callback;
		return this;
	}
	onClick(callback: typeof this.click) {
		this.click = callback;
		return this;
	}
}

export class FakeSetting {
	static items: FakeSetting[] = [];
	name = "";
	control?: FakeControl;
	components: FakeControl[] = [];
	settingEl = new FakeElement();
	constructor(_container: any) {
		FakeSetting.items.push(this);
	}
	setName(name: string) {
		this.name = name;
		return this;
	}
	setDesc(_description: any) {
		return this;
	}
	setHeading() {
		return this;
	}
	setNoInfo() {
		return this;
	}
	setClass(_name: string) {
		return this;
	}
	addToggle(callback: (control: FakeControl) => void) {
		this.control = new FakeControl();
		this.components.push(this.control);
		callback(this.control);
		return this;
	}
	addText(callback: (control: FakeControl) => void) {
		return this.addToggle(callback);
	}
	addTextArea(callback: (control: FakeControl) => void) {
		return this.addToggle(callback);
	}
	addDropdown(callback: (control: FakeControl) => void) {
		return this.addToggle(callback);
	}
	addButton(callback: (control: FakeControl) => void) {
		return this.addToggle(callback);
	}
	addComponent(callback: (el: any) => any) {
		callback(new FakeElement());
		return this;
	}
}

export class FakeNotice {
	static messages: string[] = [];
	noticeEl = new FakeElement();
	constructor(message: any, _duration?: number) {
		FakeNotice.messages.push(String(message));
	}
	hide() {}
}
class FakeModal {
	contentEl = new FakeElement();
	constructor(public app: any) {}
	open() {}
	close() {}
}
class FakeComponent {
	load() {}
	unload() {}
}
class FakePlugin {
	app: any;
	manifest: any;
	constructor(app?: any, manifest?: any) {
		this.app = app;
		this.manifest = manifest;
	}
	async loadData() {
		return null;
	}
	async saveData(_data: any) {}
	addStatusBarItem() {
		return new FakeElement();
	}
	addCommand(_command: any) {}
	registerEvent(_event: any) {}
	addSettingTab(_tab: any) {}
}

export const fakePlatform = { isDesktop: true, isMobile: false };
export let dataviewAPI: any;
export function setDataviewAPI(api: any) {
	dataviewAPI = api;
}
const moment = Object.assign(
	(_date?: any) => ({
		format: () => "2026-10-03",
		locale: () => "en",
		toDate: () => new Date(),
	}),
	{ locale: () => "en" }
);

mock.module("obsidian", () => ({
	TFile: FakeTFile,
	TFolder: FakeTFolder,
	Vault: class {
		static recurseChildren(folder: FakeTFolder, callback: (file: any) => void) {
			folder.children.forEach((file) => {
				callback(file);
				if (file instanceof FakeTFolder) this.recurseChildren(file, callback);
			});
		}
	},
	Notice: FakeNotice,
	Setting: FakeSetting,
	Modal: FakeModal,
	FuzzySuggestModal: FakeModal,
	AbstractInputSuggest: FakeModal,
	Component: FakeComponent,
	Plugin: FakePlugin,
	PluginSettingTab: FakeModal,
	SecretComponent: FakeControl,
	ButtonComponent: FakeControl,
	TextAreaComponent: FakeControl,
	Platform: fakePlatform,
	moment,
	parseYaml: (source: string) => Bun.YAML.parse(source),
	stringifyYaml: (object: any) => Bun.YAML.stringify(object) + "\n",
	getFrontMatterInfo: (text: string) => {
		const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
		return {
			exists: Boolean(match),
			frontmatter: match?.[1] ?? "",
			from: match ? text.indexOf("\n") + 1 : 0,
			to: match ? text.indexOf("\n") + 1 + match[1].length : 0,
			contentStart: match?.[0].length ?? 0,
		};
	},
	normalizePath: (path: string) =>
		path
			.replace(/\\/g, "/")
			.replace(/\/{2,}/g, "/")
			.replace(/^\/+|\/+$/g, ""),
	parseFrontMatterTags: (frontmatter: any) =>
		frontmatter?.tags
			? Array.isArray(frontmatter.tags)
				? frontmatter.tags
				: String(frontmatter.tags).split(/[, ]+/)
			: null,
	parseLinktext: (link: string) => ({
		path: link.split("#")[0],
		subpath: link.includes("#") ? "#" + link.split("#")[1] : "",
	}),
	resolveSubpath: () => null,
	sanitizeHTMLToDom: () => new FakeElement(),
	htmlToMarkdown: (html: any) => String(html),
	setIcon: () => {},
}));
mock.module("obsidian-dataview", () => ({
	getAPI: () => dataviewAPI,
	Link: class {
		constructor(public path: string) {}
	},
}));

for (const prototype of [String.prototype, Array.prototype]) {
	if (!(prototype as any).contains)
		Object.defineProperty(prototype, "contains", {
			value: function (this: any, value: any) {
				return this.includes(value);
			},
			configurable: true,
		});
}
const document = {
	createDocumentFragment: () => new FakeElement(),
	createElement: () => new FakeElement(),
	querySelector: () => null,
};
Object.assign(globalThis, {
	document,
	activeDocument: document,
	window: { localStorage: { language: "en" } },
	createFragment: () => new FakeElement(),
	createEl: () => new FakeElement(),
});
