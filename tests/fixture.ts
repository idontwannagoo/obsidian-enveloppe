import type { EnveloppeSettings } from "@interfaces";
import { DEFAULT_SETTINGS } from "../src/interfaces/constant";
import { GithubBranch } from "../src/GitHub/branch";
import type Enveloppe from "../src/main";
import { FakeElement, FakeTFile, FakeTFolder } from "./preload";
import { FakeGithub } from "./fake_github";

export function fixture() {
	const settings = structuredClone(DEFAULT_SETTINGS) as EnveloppeSettings;
	Object.assign(settings.github, {
		user: "user",
		repo: "blog",
		branch: "master",
		directPublish: true,
		verifiedRepo: true,
		rateLimit: 4997,
	});
	settings.upload.defaultName = "source/_posts";
	const files = new Map<string, FakeTFile>();
	const text = new Map<string, string>();
	const binary = new Map<string, Uint8Array>();
	const caches = new Map<string, any>();
	const errors: Error[] = [];
	const writes: string[] = [];
	const folder = new FakeTFolder("00-Blog-Publish");
	const vault = {
		getName: () => "测试笔记库",
		getFiles: () => [...files.values()],
		getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === "md"),
		getAbstractFileByPath: (path: string) => files.get(path),
		cachedRead: async (file: FakeTFile) => text.get(file.path) ?? "",
		read: async (file: FakeTFile) => text.get(file.path) ?? "",
		readBinary: async (file: FakeTFile) => binary.get(file.path)!.slice().buffer,
		adapter: {
			read: async (path: string) => text.get(path) ?? "",
			exists: async () => false,
		},
	};
	const app = {
		vault,
		fileManager: {
			processFrontMatter: async (
				file: FakeTFile,
				callback: (frontmatter: Record<string, any>) => void
			) => {
				const raw = text.get(file.path)!;
				const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
				const frontmatter = (match ? Bun.YAML.parse(match[1]) : {}) as Record<
					string,
					any
				>;
				callback(frontmatter);
				text.set(
					file.path,
					"---\n" +
						Bun.YAML.stringify(frontmatter) +
						"\n---\n" +
						raw.slice(match?.[0].length ?? 0)
				);
				writes.push(file.path);
				// 故意不刷新 metadataCache，模拟实际 Obsidian 的异步刷新。
			},
		},
		metadataCache: {
			getCache: (path: string) => caches.get(path),
			getFileCache: (file: FakeTFile) => caches.get(file.path),
			getFirstLinkpathDest: (path: string) =>
				files.get(path) ??
				[...files.values()].find((file) => file.name === path || file.basename === path),
			getBacklinksForFile: () => ({ data: new Map() }),
		},
		plugins: {
			enabledPlugins: new Set<string>(),
			plugins: {} as Record<string, any>,
			getPlugin: (_id: string) => null as any,
		},
		workspace: { getActiveFile: () => [...files.values()][0] },
	};
	const client = new FakeGithub();
	const plugin = {
		settings,
		app,
		repositoryFrontmatter: {},
		branchName: "test-branch",
		manifest: {
			id: "obsidian-mkdocs-publisher",
			dir: ".obsidian/plugins/obsidian-mkdocs-publisher",
		},
		console: {
			noticeMobile: () => undefined,
			debug: () => {},
			info: () => {},
			warn: () => {},
			trace: () => {},
			error: (error: Error) => errors.push(error),
			publisherNotification: async () => {},
			noticeErrorUpload: () => {},
		},
		loadToken: async () => "test-token",
		saveSettings: async () => {},
		addStatusBarItem: () => new FakeElement(),
		reloadOctokit: async () => publisher,
	} as unknown as Enveloppe;
	const publisher = new GithubBranch(client as any, plugin);
	const note = (
		name: string,
		body = "本地内容",
		frontmatter: Record<string, any> = {}
	) => {
		const file = new FakeTFile("00-Blog-Publish/" + name + ".md");
		file.parent = folder;
		folder.children.push(file);
		files.set(file.path, file);
		const properties = { share: true, title: name, ...frontmatter };
		text.set(file.path, "---\n" + Bun.YAML.stringify(properties) + "\n---\n" + body);
		caches.set(file.path, { frontmatter: properties, embeds: [], links: [] });
		return file as any;
	};
	const image = (name: string, bytes: Uint8Array) => {
		const file = new FakeTFile("Attached/" + name);
		files.set(file.path, file);
		binary.set(file.path, bytes);
		caches.set(file.path, {});
		return file as any;
	};
	return {
		settings,
		plugin,
		publisher,
		client,
		note,
		image,
		files,
		text,
		binary,
		caches,
		app,
		folder,
		errors,
		writes,
	};
}
