import { beforeAll, expect, test } from "bun:test";
import i18next from "i18next";
import { resources } from "../src/i18n/i18next";
import { FolderSettings } from "../src/interfaces/enum";
import { getProperties } from "../src/utils/parse_frontmatter";
import { filterGithubFile } from "../src/GitHub/delete";
import { publishDirectFiles } from "../src/GitHub/direct_publish";
import { fixture } from "./fixture";

beforeAll(async () => {
	await i18next.init({ lng: "zhCN", fallbackLng: "en", resources });
});

const protectedFiles = [
	"scaffolds/draft.md",
	"scaffolds/page.md",
	"scaffolds/post.md",
	"source/_drafts/草稿.md",
	"README.md",
	"backup/source/_posts/文章.md",
	"source/_posts-backup/文章.md",
];

test("Property key 空根目录不匹配整个仓库，目录匹配包含路径边界", async () => {
	const f = fixture();
	f.settings.upload.behavior = FolderSettings.Yaml;
	f.settings.upload.rootFolder = "";
	f.settings.embed.folder = "source/images";
	const paths = [
		...protectedFiles,
		"source/_posts/文章.md",
		"source/_posts/sub/文章.md",
		"source/images/图.png",
		"backup/source/images/图.png",
	];
	const result = await filterGithubFile(
		paths.map((file) => ({ file, sha: "sha" })),
		f.settings,
		getProperties(f.plugin, null) as any
	);
	expect(result.map((x) => x.file)).toEqual([
		"source/_posts/文章.md",
		"source/_posts/sub/文章.md",
		"source/images/图.png",
	]);
});
test("所有目录为空或仅有斜杠时不产生删除候选", async () => {
	for (const directory of ["", " / "]) {
		const f = fixture();
		f.settings.upload.behavior = FolderSettings.Yaml;
		f.settings.upload.defaultName = directory;
		f.settings.upload.rootFolder = directory;
		f.settings.embed.folder = directory;
		const result = await filterGithubFile(
			[{ file: "source/_posts/A.md", sha: "sha" }],
			f.settings,
			getProperties(f.plugin, null) as any
		);
		expect(result).toEqual([]);
	}
});
test("仓库目录覆盖仍生效，尾部斜杠与前导斜杠规范化", async () => {
	const f = fixture();
	f.settings.upload.behavior = FolderSettings.Yaml;
	const prop = getProperties(f.plugin, null) as any;
	prop.path = {
		type: FolderSettings.Yaml,
		defaultName: " /publish/posts/ ",
		rootFolder: "",
	};
	const paths = [
		"source/_posts/A.md",
		"publish/posts/A.md",
		"publish/posts-copy/A.md",
		"backup/publish/posts/A.md",
	];
	expect(
		(
			await filterGithubFile(
				paths.map((file) => ({ file, sha: "sha" })),
				f.settings,
				prop
			)
		).map((x) => x.file)
	).toEqual(["publish/posts/A.md"]);
});
test("实际批量清理只删除 share:false 的文章，保留模板草稿及排除目录", async () => {
	const f = fixture();
	f.settings.upload.behavior = FolderSettings.Yaml;
	f.settings.upload.rootFolder = "";
	f.settings.upload.autoclean.enable = true;
	f.settings.upload.autoclean.excluded = ["/^(?!source\\/_posts\\/).*/"];
	f.settings.embed.folder = "source/images";
	const a = f.note("A");
	f.note("B", "不再发布", { share: false });
	for (const file of [
		...protectedFiles,
		"source/_posts/B.md",
		"source/images/远端图片.png",
	])
		f.client.files.set(file, "old");
	await publishDirectFiles(f.publisher, [a], null);
	expect(f.errors).toEqual([]);
	expect(f.client.input.fileChanges.deletions).toEqual([{ path: "source/_posts/B.md" }]);
	for (const file of [...protectedFiles, "source/images/远端图片.png"])
		expect(f.client.files.has(file)).toBe(true);
});
