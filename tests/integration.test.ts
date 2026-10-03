import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import i18next from "i18next";
import { Base64 } from "js-base64";
import { FolderSettings } from "../src/interfaces/enum";
import { resources } from "../src/i18n/i18next";
import { publishDirectFiles, useDirectPublish } from "../src/GitHub/direct_publish";
import { renderGithubConfiguration } from "../src/settings/renders/github";
import Enveloppe from "../src/main";
import { uploadAllNotes, shareAllMarkedNotes } from "../src/commands/share/all_notes";
import {
	uploadAllEditedNotes,
	shareEditedOnly,
} from "../src/commands/share/edited_notes";
import { uploadNewNotes } from "../src/commands/share/new_notes";
import { shareOneNote } from "../src/commands/share/unique_note";
import {
	getProperties,
	frontmatterSettingsRepository,
} from "../src/utils/parse_frontmatter";
import {
	FakeElement,
	FakeNotice,
	FakeSetting,
	fakePlatform,
	setDataviewAPI,
} from "./preload";
import { fixture } from "./fixture";

beforeAll(async () => {
	await i18next.init({
		lng: "zhCN",
		fallbackLng: "en",
		returnEmptyString: false,
		resources,
	});
});
beforeEach(() => {
	FakeNotice.messages = [];
	fakePlatform.isDesktop = true;
	fakePlatform.isMobile = false;
	setDataviewAPI(undefined);
});

describe("发布入口与转换", () => {
	for (const entry of [
		"当前文章",
		"所有已标记",
		"新增和修改",
		"仅新增",
		"仅修改",
		"文件夹",
	] as const) {
		test(entry + " 接入批量直提", async () => {
			const f = fixture();
			const a = f.note("中文标题");
			if (entry === "仅修改")
				f.client.files.set("source/_posts/中文标题.md", "远端旧内容");
			const prop = getProperties(f.plugin, null) as any;
			const mono = {
				frontmatter: prop,
				repository: null,
				convert: frontmatterSettingsRepository(f.plugin, null),
			};
			if (entry === "当前文章") await shareOneNote(f.publisher, a, null, null);
			if (entry === "所有已标记") await uploadAllNotes(f.plugin, null, "test-branch");
			if (entry === "新增和修改") await uploadAllEditedNotes(f.plugin, "test-branch");
			if (entry === "仅新增") await uploadNewNotes(f.plugin, "test-branch", null);
			if (entry === "仅修改") await shareEditedOnly("test-branch", null, f.plugin);
			if (entry === "文件夹")
				await shareAllMarkedNotes(
					f.publisher,
					new FakeElement() as any,
					"test-branch",
					mono,
					f.publisher.getSharedFileOfFolder(f.folder as any, null, true)
				);
			expect(f.errors.map((error) => error.message)).toEqual([]);
			expect(f.client.calls).toHaveLength(2);
			expect(f.client.input.fileChanges.additions[0].path).toBe(
				"source/_posts/中文标题.md"
			);
			expect(Base64.decode(f.client.input.fileChanges.additions[0].contents)).toContain(
				"本地内容"
			);
		});
	}

	test("使用转换后的内容，二次发布只有一次请求", async () => {
		const f = fixture();
		const a = f.note("转换测试", "```dataview\nLIST\n```\n");
		f.app.plugins.enabledPlugins.add("dataview");
		f.app.plugins.plugins.dataview = { _loaded: true };
		setDataviewAPI({
			settings: {},
			tryQueryMarkdown: async () => "- 已转换的查询结果\n",
			page: () => undefined,
		});
		const first = await publishDirectFiles(f.publisher, [a], null);
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(first?.requests).toBe(2);
		const published = Base64.decode(f.client.input.fileChanges.additions[0].contents);
		expect(published).toContain("已转换的查询结果");
		expect(published).not.toContain("```dataview");
		const second = await publishDirectFiles(f.publisher, [a], null);
		expect(second?.requests).toBe(1);
		expect(second?.results[0].commit).toBeUndefined();
	});

	test("移动端独立发布 Markdown 和图片，重复附件合并", async () => {
		const f = fixture();
		fakePlatform.isDesktop = false;
		fakePlatform.isMobile = true;
		const a = f.note("A", "![[图.png]]");
		const b = f.note("B", "![[图.png]]");
		f.image("图.png", new Uint8Array([0, 255, 10, 128]));
		for (const note of [a, b])
			f.caches.get(note.path).embeds = [
				{
					link: "图.png",
					original: "![[图.png]]",
					position: { start: { offset: 0 }, end: { offset: 12 } },
				},
			];
		const report = await publishDirectFiles(f.publisher, [a, b], null);
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(report?.requests).toBe(2);
		expect(f.client.input.fileChanges.additions).toHaveLength(3);
		const image = f.client.input.fileChanges.additions.find((entry: any) =>
			entry.path.endsWith("图.png")
		);
		expect(Base64.toUint8Array(image.contents)).toEqual(
			new Uint8Array([0, 255, 10, 128])
		);
		const second = await publishDirectFiles(f.publisher, [a, b], null);
		expect(second?.requests).toBe(1);
	});

	test("当前文章保留嵌入文章的深度发布，并终止循环引用", async () => {
		const f = fixture();
		f.settings.embed.notes = true;
		const a = f.note("A", "![[B]]");
		const b = f.note("B", "![[A]]");
		for (const [note, link] of [
			[a, "B"],
			[b, "A"],
		] as const)
			f.caches.get(note.path).embeds = [
				{
					link,
					original: "![[" + link + "]]",
					position: { start: { offset: 0 }, end: { offset: 6 } },
				},
			];
		const result = await publishDirectFiles(f.publisher, [a], null, { deepScan: true });
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(result?.requests).toBe(2);
		expect(f.client.input.fileChanges.additions).toHaveLength(2);
	});

	test("不同仓库各自批量提交，不合并目标", async () => {
		const f = fixture();
		const a = f.note("A", "内容", {
			multipleRepo: ["user/blog/master", "user/another/main"],
		});
		const result = await publishDirectFiles(f.publisher, [a], null);
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(result?.results).toHaveLength(2);
		expect(result?.requests).toBe(4);
		expect(
			f.client.calls
				.filter((call) => call.query.startsWith("mutation"))
				.map((call) => call.variables.input.branch.repositoryNameWithOwner)
		).toEqual(["user/blog", "user/another"]);
	});

	test("有效自动清理保留排除项、受保护 index 和无关目录", async () => {
		const f = fixture();
		f.settings.upload.behavior = FolderSettings.Obsidian;
		f.settings.upload.defaultName = "docs";
		f.settings.upload.autoclean.enable = true;
		f.settings.upload.autoclean.excluded = ["keep.md"];
		for (const path of [
			"docs/old.md",
			"docs/keep.md",
			"docs/index.md",
			"themes/custom.md",
		])
			f.client.files.set(path, "old-sha");
		f.client.contents.set("docs/index.md", "---\nshare: false\n---\n保留");
		const result = await publishDirectFiles(f.publisher, [f.note("A")], null);
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(result?.requests).toBe(4);
		expect(f.client.input.fileChanges.deletions).toEqual([{ path: "docs/old.md" }]);
		expect(f.client.files.has("docs/keep.md")).toBe(true);
		expect(f.client.files.has("docs/index.md")).toBe(true);
		expect(f.client.files.has("themes/custom.md")).toBe(true);
		expect(f.client.restCalls[1].variables.ref).toBe("c100");
	});

	test("当前固定目录配置不启动自动清理，仍然两次请求", async () => {
		const f = fixture();
		f.settings.upload.autoclean.enable = true;
		f.client.files.set("source/_posts/remote-only.md", "保留远端独有文章");
		const result = await publishDirectFiles(f.publisher, [f.note("A")], null);
		expect(result?.requests).toBe(2);
		expect(f.client.restCalls).toHaveLength(0);
		expect(f.client.files.has("source/_posts/remote-only.md")).toBe(true);
	});

	test("Excalidraw 在移动端转换为 SVG 后上传", async () => {
		const f = fixture();
		fakePlatform.isDesktop = false;
		fakePlatform.isMobile = true;
		const note = f.note("绘图", "![[图.excalidraw.md]]");
		f.image("图.excalidraw.md", new TextEncoder().encode("原始绘图"));
		f.caches.get(note.path).embeds = [
			{
				link: "图.excalidraw.md",
				original: "![[图.excalidraw.md]]",
				position: { start: { offset: 0 }, end: { offset: 24 } },
			},
		];
		f.app.plugins.getPlugin = () => ({
			ea: {
				getExportSettings: () => ({}),
				getEmbeddedFilesLoader: () => ({}),
				createSVG: async () => ({
					outerHTML: '<svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>',
				}),
			},
		});
		const result = await publishDirectFiles(f.publisher, [note], null);
		expect(f.errors.map((error) => error.message)).toEqual([]);
		expect(result?.requests).toBe(2);
		const image = f.client.input.fileChanges.additions.find((entry: any) =>
			entry.path.endsWith(".svg")
		);
		expect(image).toBeDefined();
		expect(Base64.decode(image.contents)).toContain("<text>中文</text>");
	});

	test("错误出现在界面，不显示发布成功", async () => {
		const f = fixture();
		f.client.readError = new Error("Bad credentials");
		expect(await publishDirectFiles(f.publisher, [f.note("A")], null)).toBeNull();
		expect(
			FakeNotice.messages.some((message) => message.includes("Bad credentials"))
		).toBe(true);
		expect(FakeNotice.messages.some((message) => message.includes("已发布"))).toBe(false);
	});

	test("关闭开关继续走原有 PR 流程", async () => {
		const f = fixture();
		f.settings.github.directPublish = false;
		const a = f.note("A");
		const calls: string[] = [];
		f.publisher.newBranch = async () => {
			calls.push("branch");
		};
		f.publisher.publish = async () => {
			calls.push("upload");
			return {
				uploaded: [{ file: "A.md", isUpdated: true }],
				deleted: { success: false, deleted: [], undeleted: [] },
				error: [],
			};
		};
		f.publisher.updateRepository = async () => {
			calls.push("pr");
			return true;
		};
		await shareOneNote(f.publisher, a, null, null);
		expect(calls).toEqual(["branch", "upload", "pr"]);
		expect(f.client.calls).toHaveLength(0);
	});
});

describe("设置界面", () => {
	test("直提开启时禁用自动合并，关闭恢复原值并持久化", async () => {
		const f = fixture();
		f.settings.github.directPublish = false;
		let saved = 0;
		f.plugin.saveSettings = async () => {
			saved++;
		};
		const ctx: any = {
			app: f.app,
			plugin: f.plugin,
			settings: f.settings,
			settingsPage: new FakeElement(),
			branchName: "test",
			copy: (value: any) => structuredClone(value),
			renderSettingsPage: async () => {
				FakeSetting.items = [];
				await renderGithubConfiguration(ctx);
			},
		};
		await ctx.renderSettingsPage();
		const toggle = () =>
			FakeSetting.items.find((item) => item.name === "直接提交到目标分支")!.control!;
		const merge = () =>
			FakeSetting.items.find(
				(item) => item.name === i18next.t("settings.github.automaticallyMergePR")
			)!.control!;
		expect(merge().disabled).toBe(false);
		expect(merge().value).toBe(true);
		expect(i18next.t("settings.github.automaticallyMergePR")).toBe("自动合并 PR");
		await toggle().change(true);
		expect(merge().disabled).toBe(true);
		expect(merge().value).toBe(true);
		expect(f.settings.github.automaticallyMergePR).toBe(true);
		await toggle().change(false);
		expect(merge().disabled).toBe(false);
		expect(merge().value).toBe(true);
		expect(saved).toBe(2);
	});

	test("旧配置缺少新字段时默认为关闭，dry-run 不走直提", async () => {
		const f = fixture();
		delete f.settings.github.directPublish;
		const plugin = new (Enveloppe as any)(f.app, f.plugin.manifest) as Enveloppe;
		plugin.loadData = async () => structuredClone(f.settings);
		await plugin.loadSettings();
		expect(plugin.settings.github.directPublish).toBe(false);
		expect(useDirectPublish(plugin)).toBe(false);
		f.settings.github.directPublish = true;
		f.settings.github.dryRun.enable = true;
		expect(useDirectPublish(f.plugin)).toBe(false);
	});
});
