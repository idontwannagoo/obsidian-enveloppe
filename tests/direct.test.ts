import { describe, expect, test } from "bun:test";
import { Base64 } from "js-base64";
import {
	addDirectFile,
	gitBlobSha,
	prepareDirectFile,
	publishDirectBatch,
	type DirectClient,
	type DirectFile,
} from "../src/GitHub/direct";

import { FakeGithub } from "./fake_github";

const target = { owner: "user", repo: "blog", branch: "master" };
const bytes = (text: string) => new TextEncoder().encode(text);
const file = (path: string, text: string, roots?: string[]) =>
	prepareDirectFile(path, bytes(text), roots);

for (const sample of [
	new Uint8Array(),
	bytes("中文标题 😀\n内容"),
	bytes("line\r\nnext\n"),
	new Uint8Array([0, 255, 128, 1]),
]) {
	test(
		"Git blob SHA 与 git hash-object 一致：" + sample.byteLength + " 字节",
		async () => {
			const git = Bun.spawnSync(["git", "hash-object", "--stdin"], { stdin: sample });
			expect(git.exitCode).toBe(0);
			expect(await gitBlobSha(sample)).toBe(new TextDecoder().decode(git.stdout).trim());
		}
	);
}

describe("直接发布", () => {
	test("内容相同仅查询一次，不产生空提交", async () => {
		const client = new FakeGithub();
		const a = await file("source/_posts/A.md", "相同内容");
		client.files.set(a.path, a.sha);
		const result = await publishDirectBatch(client, target, [a]);
		expect(result.requests).toBe(1);
		expect(client.calls).toHaveLength(1);
		expect(result.commit).toBeUndefined();
	});

	test("中文路径、新增、修改和二进制附件一次提交，忽略修改时间", async () => {
		const client = new FakeGithub();
		const a = await file("source/_posts/中文 A.md", "本地旧时间但新内容");
		const b = await file("source/_posts/B.md", "不变");
		const image = await prepareDirectFile(
			"images/截图.png",
			new Uint8Array([0, 255, 128, 1]),
			[a.path]
		);
		client.files.set(a.path, "远端其他内容");
		client.files.set(b.path, b.sha);
		const result = await publishDirectBatch(client, target, [a, b, image]);
		expect(result.requests).toBe(2);
		expect(client.calls).toHaveLength(2);
		expect(client.input.expectedHeadOid).toBe("c100");
		expect(client.input.branch).toEqual({
			repositoryNameWithOwner: "user/blog",
			branchName: "master",
		});
		expect(client.input.fileChanges.additions.map((entry: any) => entry.path)).toEqual([
			a.path,
			image.path,
		]);
		expect(Base64.toUint8Array(client.input.fileChanges.additions[1].contents)).toEqual(
			new Uint8Array([0, 255, 128, 1])
		);
	});

	for (const count of [27, 500]) {
		test(count + " 篇文章仍然是两次请求", async () => {
			const client = new FakeGithub();
			const candidates = await Promise.all(
				Array.from({ length: count }, (_, i) =>
					file("source/_posts/" + i + ".md", "内容 " + i)
				)
			);
			candidates.forEach((entry, i) =>
				client.files.set(entry.path, i === count - 1 ? "旧内容" : entry.sha)
			);
			const result = await publishDirectBatch(client, target, candidates);
			expect(result.requests).toBe(2);
			expect(result.uploaded).toHaveLength(1);
			expect(client.calls).toHaveLength(2);
			expect(client.calls[0].query).not.toContain("history");
			expect([...client.calls[0].query.matchAll(/file\(path:/g)]).toHaveLength(1);
		});
	}

	for (const selection of ["new", "edited"] as const) {
		test(selection + " 保留文章范围，附件随所属文章筛选", async () => {
			const client = new FakeGithub();
			const a = await file("A.md", "修改");
			const c = await file("C.md", "新增");
			const shared = await file("shared.png", "共用图片", [a.path, c.path]);
			const onlyA = await file("only-a.png", "A 图片", [a.path]);
			client.files.set(a.path, "旧 A");
			await publishDirectBatch(client, target, [a, c, shared, onlyA], { selection });
			expect(client.input.fileChanges.additions.map((entry: any) => entry.path)).toEqual(
				selection === "new"
					? ["C.md", "shared.png"]
					: ["A.md", "shared.png", "only-a.png"]
			);
		});
	}

	test("自动清理删除与更新进入同一个提交", async () => {
		const client = new FakeGithub();
		const a = await file("A.md", "更新");
		const result = await publishDirectBatch(client, target, [a], {
			loadDeletions: async () => ({ paths: ["old.md", "A.md", "old.md"], requests: 1 }),
		});
		expect(result.requests).toBe(3);
		expect(client.input.fileChanges.deletions).toEqual([{ path: "old.md" }]);
	});

	test("目标分支变化时刷新并覆盖最新远端内容", async () => {
		const client = new FakeGithub();
		const a = await file("A.md", "本地内容");
		let first = true;
		client.beforeCommit = () => {
			if (first) {
				client.head = "c101";
				client.files.set(a.path, "另一个设备的内容");
				first = false;
			}
		};
		const result = await publishDirectBatch(client, target, [a]);
		expect(result.requests).toBe(4);
		expect(client.input.expectedHeadOid).toBe("c101");
		expect(client.files.get(a.path)).toBe(a.sha);
	});

	test("刷新后发现别人已发布相同内容，不再提交", async () => {
		const client = new FakeGithub();
		const a = await file("A.md", "相同的新内容");
		client.beforeCommit = () => {
			client.head = "c101";
			client.files.set(a.path, a.sha);
		};
		const result = await publishDirectBatch(client, target, [a]);
		expect(result.requests).toBe(3);
		expect(result.commit).toBeUndefined();
	});

	test("连续分支变化只重试一次", async () => {
		const client = new FakeGithub();
		client.beforeCommit = () => {
			client.head += "race";
		};
		await expect(
			publishDirectBatch(client, target, [await file("A.md", "内容")])
		).rejects.toThrow("Expected branch");
		expect(client.calls).toHaveLength(4);
	});

	test("认证失败直接报告，一次查询后停止", async () => {
		const client = new FakeGithub();
		client.readError = new Error("Bad credentials");
		await expect(
			publishDirectBatch(client, target, [await file("A.md", "内容")])
		).rejects.toThrow("Bad credentials");
		expect(client.calls).toHaveLength(1);
	});

	for (const error of [
		{ type: "FORBIDDEN", path: ["repository", "ref", "target", "d0"] },
		{ type: "NOT_FOUND", path: ["repository"] },
	]) {
		test("部分 GraphQL 响应不能掩盖 " + error.type + " 仓库或权限错误", async () => {
			const client = new FakeGithub();
			client.readError = Object.assign(new Error("仓库或权限错误"), {
				errors: [error],
				data: {
					repository: {
						ref: { target: { oid: "c100", tree: { oid: "tree100" }, d0: null } },
					},
				},
			});
			await expect(
				publishDirectBatch(client, target, [await file("source/_posts/A.md", "内容")])
			).rejects.toThrow("仓库或权限错误");
			expect(client.calls).toHaveLength(1);
		});
	}

	test("提交失败不重试、不报告发布成功", async () => {
		const client = new FakeGithub();
		client.beforeCommit = () => {
			throw new Error("Resource not accessible by token");
		};
		await expect(
			publishDirectBatch(client, target, [await file("A.md", "内容")])
		).rejects.toThrow("Resource not accessible");
		expect(client.calls).toHaveLength(2);
	});

	test("相同路径的附件合并来源，不同内容报错", async () => {
		const files = new Map<string, DirectFile>();
		addDirectFile(files, await file("image.png", "相同", ["A.md"]));
		addDirectFile(files, await file("image.png", "相同", ["B.md"]));
		expect(files.get("image.png")?.selectedBy).toEqual(["A.md", "B.md"]);
		const other = await file("image.png", "不同");
		expect(() => addDirectFile(files, other)).toThrow("同一个发布路径");
	});
});
