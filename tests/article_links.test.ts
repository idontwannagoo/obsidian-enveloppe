import { beforeAll, test, expect } from "bun:test";
import i18next from "i18next";
import { Base64 } from "js-base64";
import { resources } from "../src/i18n/i18next";
import { crc16, ensureAbbrlink } from "../src/conversion/article_links";
import { publishDirectFiles } from "../src/GitHub/direct_publish";
import { renderTextConversion } from "../src/settings/renders/text_conversion";
import { fixture } from "./fixture";
import { FakeElement, FakeSetting, fakePlatform } from "./preload";

beforeAll(async () => {
	await i18next.init({ lng: "zhCN", fallbackLng: "en", resources });
});
function configured() {
	const f = fixture();
	Object.assign(f.settings.conversion.links, {
		autoAbbrlink: true,
		webTemplate: "/posts/{abbrlink}/",
		internal: true,
		wiki: true,
	});
	return f;
}
function link(
	f: ReturnType<typeof fixture>,
	a: any,
	target: string,
	original = `[[${target}]]`
) {
	f.caches
		.get(a.path)
		.links.push({
			link: target,
			original,
			displayText: original.match(/\|([^\]]+)/)?.[1],
			position: { start: { offset: 0 }, end: { offset: original.length } },
		});
}
function uploaded(f: ReturnType<typeof fixture>, name: string) {
	return Base64.decode(
		f.client.input.fileChanges.additions.find((x: any) =>
			x.path.endsWith("/" + name + ".md")
		).contents
	);
}

test("UTF-8 CRC16 与现有 Hexo 文章的编号一致", () => {
	expect(crc16("正确的废话：解决问题的一般方法")).toBe(58075);
	expect(crc16("《嫌疑人 X 的献身》读后感")).toBe(21384);
	expect(crc16("个人博客建站教程 —— 使用 Hexo、Vercel、Github 和 Qexo")).toBe(688);
});
test("首次同批发布先补编号，再转换 A → B；缓存未刷新，第二次仍只查询一次", async () => {
	const f = configured();
	const a = f.note("A", "参考 [[B|另一篇文章]] 和 [原文](B.md)。");
	const b = f.note("B");
	link(f, a, "B", "[[B|另一篇文章]]");
	link(f, a, "B.md", "[原文](B.md)");
	expect((await publishDirectFiles(f.publisher, [a, b], null))?.requests).toBe(2);
	expect(f.errors).toEqual([]);
	expect(uploaded(f, "A")).toContain(`[另一篇文章](/posts/${crc16("B")}/)`);
	expect(uploaded(f, "A")).toContain(`[原文](/posts/${crc16("B")}/)`);
	expect(f.text.get(a.path)).toContain("[[B|另一篇文章]]");
	expect(f.writes).toHaveLength(2);
	expect(f.caches.get(b.path).frontmatter.abbrlink).toBeUndefined();
	expect((await publishDirectFiles(f.publisher, [a, b], null))?.requests).toBe(1);
	expect(f.writes).toHaveLength(2);
});
test("同标题文章分配不重复，空编号补全；改标题、路径和日期后沿用编号", async () => {
	const f = configured();
	const a = f.note("A", "", { title: "一样", abbrlink: null });
	const b = f.note("B", "", { title: "一样", abbrlink: "" });
	const [first, second] = await Promise.all([
		ensureAbbrlink(a, f.plugin),
		ensureAbbrlink(b, f.plugin),
	]);
	expect(first?.frontmatter.abbrlink).toBe(crc16("一样"));
	expect(second?.frontmatter.abbrlink).toBe(crc16("一样") + 1);
	const text = f.text.get(a.path)!.replace("一样", "改标题");
	f.text.delete(a.path);
	a.path = "Moved/改文件名.md";
	f.text.set(a.path, text);
	expect((await ensureAbbrlink(a, f.plugin))?.frontmatter.abbrlink).toBe(
		first?.frontmatter.abbrlink
	);
	expect(f.writes).toHaveLength(2);
});
test("已有自定义编号保留，同一篇并发分配只写一次，写失败不访问 GitHub", async () => {
	const f = configured();
	const a = f.note("A", "", { abbrlink: "固定编号" });
	await ensureAbbrlink(a, f.plugin);
	expect(f.writes).toHaveLength(0);
	const b = f.note("B");
	const results = await Promise.all([
		ensureAbbrlink(b, f.plugin),
		ensureAbbrlink(b, f.plugin),
	]);
	expect(results[0]?.frontmatter.abbrlink).toBe(results[1]?.frontmatter.abbrlink);
	expect(f.writes).toHaveLength(1);
	f.app.fileManager.processFrontMatter = async () => {
		throw new Error("写入失败");
	};
	await publishDirectFiles(f.publisher, [f.note("C")], null);
	expect(f.client.calls).toHaveLength(0);
	expect(f.errors[0].message).toBe("写入失败");
});
test("中文模板字段、显示文字、标题锚点、代码与转义链接", async () => {
	const f = configured();
	f.settings.conversion.links.webTemplate = "https://blog.example/articles/{slug}/";
	f.note("B", "", { slug: "中文 标题", abbrlink: 42 });
	const a = f.note("A", "[[B#小节|阅读]]\n`[[B]]`\n```md\n[[B]]\n```\n\\[[B]]");
	link(f, a, "B#小节", "[[B#小节|阅读]]");
	link(f, a, "B");
	await publishDirectFiles(f.publisher, [a], null);
	expect(f.errors).toEqual([]);
	expect(uploaded(f, "A")).toContain(
		`[阅读](https://blog.example/articles/${encodeURIComponent("中文 标题")}/#${encodeURI("小节")})`
	);
	expect(uploaded(f, "A")).toContain("`[[B]]`");
	expect(uploaded(f, "A")).toContain("```md\n[[B]]\n```");
	expect(uploaded(f, "A")).toContain("\\[[B]]");
});
test("缺字段和无效模板在网络请求前报错，引用不扩大发布范围", async () => {
	for (const template of ["/posts/{abbrlink}/", "javascript:evil"]) {
		const f = configured();
		f.settings.conversion.links.webTemplate = template;
		f.note("B", "", template.startsWith("/") ? {} : { abbrlink: 42 });
		const a = f.note("A", "[[B]]");
		link(f, a, "B");
		await publishDirectFiles(f.publisher, [a], null);
		expect(f.client.calls).toHaveLength(0);
		expect(f.errors).toHaveLength(1);
		expect(f.writes).toEqual([a.path]);
	}
});
test("仅出现在代码中的引用不要求补编号；未分享和其他仓库目标沿用原处理", async () => {
	for (const variant of ["code", "unshared", "other"] as const) {
		const f = configured();
		f.note(
			"B",
			"",
			variant === "unshared"
				? { share: false }
				: variant === "other"
					? { multipleRepo: ["other/blog/main"] }
					: {}
		);
		const a = f.note("A", variant === "code" ? "`[[B]]`" : "[[B]]");
		link(f, a, "B");
		await publishDirectFiles(f.publisher, [a], null);
		expect(f.errors).toEqual([]);
		expect(f.client.input.fileChanges.additions).toHaveLength(1);
		expect(uploaded(f, "A")).not.toContain("/posts/");
	}
});
test("图片继续使用图片目录，手机可补编号，dry-run 不写本地", async () => {
	const f = configured();
	fakePlatform.isMobile = true;
	f.settings.embed.folder = "source/images";
	const a = f.note("A", "![[图.png]]");
	f.image("图.png", new Uint8Array([1, 2]));
	f.caches.get(a.path).embeds = [
		{
			link: "图.png",
			original: "![[图.png]]",
			position: { start: { offset: 0 }, end: { offset: 10 } },
		},
	];
	await publishDirectFiles(f.publisher, [a], null);
	fakePlatform.isMobile = false;
	expect(f.errors).toEqual([]);
	expect(f.client.input.fileChanges.additions).toHaveLength(2);
	expect(uploaded(f, "A")).toContain("images/");
	f.settings.github.dryRun.enable = true;
	await ensureAbbrlink(f.note("B"), f.plugin);
	expect(f.writes).toHaveLength(1);
});
test("27 和 500 篇使用实际准备流程，首次两次请求，重复发布一次", async () => {
	for (const count of [27, 500]) {
		const f = configured();
		const notes = Array.from({ length: count }, (_, i) => f.note("文章" + i));
		expect((await publishDirectFiles(f.publisher, notes, null))?.requests).toBe(2);
		expect(f.errors).toEqual([]);
		expect(f.writes).toHaveLength(count);
		expect((await publishDirectFiles(f.publisher, notes, null))?.requests).toBe(1);
		expect(f.writes).toHaveLength(count);
	}
});
test("两个原生设置控件保存新字段，旧配置缺字段时关闭", async () => {
	const f = fixture();
	delete f.settings.conversion.links.autoAbbrlink;
	delete f.settings.conversion.links.webTemplate;
	f.settings.conversion.links.internal = true;
	let saves = 0;
	f.plugin.saveSettings = async () => {
		saves++;
	};
	FakeSetting.items = [];
	renderTextConversion({
		plugin: f.plugin,
		settings: f.settings,
		settingsPage: new FakeElement(),
		app: f.app,
		renderSettingsPage: async () => {},
	} as any);
	const toggle = FakeSetting.items.find((x) => x.name === "首次发布时自动补全 abbrlink")!
		.control!;
	const template = FakeSetting.items.find((x) => x.name === "文章网页链接模板")!.control!;
	expect(toggle.value).toBe(false);
	expect(template.value).toBe("");
	await toggle.change(true);
	await template.change("/posts/{abbrlink}/");
	expect(f.plugin.settings.conversion.links.autoAbbrlink).toBe(true);
	expect(f.plugin.settings.conversion.links.webTemplate).toBe("/posts/{abbrlink}/");
	expect(saves).toBe(2);
});
