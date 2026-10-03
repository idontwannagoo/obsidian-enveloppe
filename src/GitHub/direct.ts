import { Base64 } from "js-base64";

export type DirectSelection = "all" | "new" | "edited";

export interface DirectFile {
	path: string;
	sha: string;
	contents: string;
	/** 决定该文件是否属于本次命令选择范围的文章路径。 */
	selectedBy: string[];
}

export interface DirectTarget {
	owner: string;
	repo: string;
	branch: string;
}

export interface DirectSnapshot {
	head: string;
	tree: string;
	files: Map<string, string>;
}

export interface DirectResult {
	commit?: string;
	uploaded: { path: string; isUpdated: boolean }[];
	deleted: string[];
	requests: number;
	elapsedMs: number;
}

export interface DirectClient {
	graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export type DeletionLoader = (
	snapshot: DirectSnapshot
) => Promise<{ paths: string[]; requests: number }>;

/** 与 Git 的 blob 对象格式一致，使用字节长度，适用于中文和二进制。 */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
	const header = new TextEncoder().encode("blob " + bytes.byteLength + "\0");
	const object = new Uint8Array(header.length + bytes.length);
	object.set(header);
	object.set(bytes, header.length);
	const digest = await globalThis.crypto.subtle.digest("SHA-1", object.buffer);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
}

export async function prepareDirectFile(
	path: string,
	bytes: Uint8Array,
	selectedBy: string[] = [path]
): Promise<DirectFile> {
	return {
		path,
		sha: await gitBlobSha(bytes),
		contents: Base64.fromUint8Array(bytes),
		selectedBy,
	};
}

export function addDirectFile(files: Map<string, DirectFile>, file: DirectFile): void {
	const existing = files.get(file.path);
	if (existing && existing.sha !== file.sha) {
		throw new Error("多个不同内容映射到同一个发布路径：" + file.path);
	}
	if (existing) {
		existing.selectedBy = [...new Set([...existing.selectedBy, ...file.selectedBy])];
	} else {
		files.set(file.path, file);
	}
}

export function selectDirectFiles(
	files: DirectFile[],
	snapshot: DirectSnapshot,
	selection: DirectSelection
): DirectFile[] {
	return files.filter((file) => {
		const inScope = file.selectedBy.some(
			(path) =>
				selection === "all" ||
				(selection === "new" ? !snapshot.files.has(path) : snapshot.files.has(path))
		);
		return inScope && snapshot.files.get(file.path) !== file.sha;
	});
}

interface TreeEntry {
	name: string;
	oid: string;
	type: string;
}

interface SnapshotResponse {
	repository: {
		ref: {
			target: {
				oid: string;
				tree: { oid: string; entries?: TreeEntry[] };
				[alias: string]: unknown;
			};
		} | null;
	} | null;
}

export async function readDirectSnapshot(
	client: DirectClient,
	target: DirectTarget,
	paths: string[]
): Promise<DirectSnapshot> {
	// 同一目录只读取一次 tree，避免 GitHub 对每个文件分别解析路径。
	const parents = [
		...new Set(paths.map((path) => path.slice(0, Math.max(0, path.lastIndexOf("/"))))),
	];
	const directories = parents.filter(Boolean);
	const aliases = new Set(directories.map((_directory, index) => "d" + index));
	const entries = "entries { name oid type }";
	const fields = directories
		.map(
			(directory, index) =>
				"d" +
				index +
				": file(path: " +
				JSON.stringify(directory) +
				") { type object { ... on Tree { " +
				entries +
				" } } }"
		)
		.join("\n");
	const query =
		"query DirectPublishSnapshot($owner: String!, $repo: String!, $ref: String!) {" +
		" repository(owner: $owner, name: $repo) { ref(qualifiedName: $ref) { target { ... on Commit {" +
		" oid tree { oid " +
		(parents.includes("") ? entries : "") +
		" } " +
		fields +
		" } } } } }";
	let data: SnapshotResponse;
	try {
		data = await client.graphql<SnapshotResponse>(query, {
			owner: target.owner,
			repo: target.repo,
			ref: target.branch.startsWith("refs/heads/")
				? target.branch
				: "refs/heads/" + target.branch,
		});
	} catch (error) {
		// 新发布目录尚不存在时，GitHub 返回 NOT_FOUND 和可用的分支快照。
		const response = error as {
			data?: SnapshotResponse;
			errors?: { type: string; path?: string[] }[];
		};
		const missingDirectoriesOnly =
			response.errors?.length &&
			response.errors.every(
				(entry) =>
					entry.type === "NOT_FOUND" &&
					entry.path?.length === 4 &&
					entry.path[0] === "repository" &&
					entry.path[1] === "ref" &&
					entry.path[2] === "target" &&
					aliases.has(entry.path[3])
			);
		if (!missingDirectoriesOnly || !response.data) throw error;
		data = response.data;
	}
	const commit = data.repository?.ref?.target;
	if (!commit?.oid || !commit.tree?.oid) {
		throw new Error(
			"找不到发布仓库或目标分支：" +
				target.owner +
				"/" +
				target.repo +
				":" +
				target.branch
		);
	}
	const files = new Map<string, string>();
	const addEntries = (directory: string, items: TreeEntry[]) => {
		for (const file of items)
			files.set(directory ? directory + "/" + file.name : file.name, file.oid);
	};
	if (parents.includes("")) addEntries("", commit.tree.entries ?? []);
	directories.forEach((directory, index) => {
		const tree = commit["d" + index] as {
			type: string;
			object: { entries: TreeEntry[] };
		} | null;
		if (!tree) return;
		if (tree.type !== "tree" || !tree.object?.entries)
			throw new Error("发布路径的父目录不是目录：" + directory);
		addEntries(directory, tree.object.entries);
	});
	return { head: commit.oid, tree: commit.tree.oid, files };
}

export function isHeadChangedError(error: unknown): boolean {
	const response = error as { errors?: { type?: string }[] };
	return (
		Array.isArray(response?.errors) &&
		response.errors.some((entry) => entry.type === "STALE_DATA")
	);
}

/** 常规路径：一次快照查询，一次批量提交；没有变化时只有查询。 */
export async function publishDirectBatch(
	client: DirectClient,
	target: DirectTarget,
	files: DirectFile[],
	options: {
		selection?: DirectSelection;
		message?: string;
		loadDeletions?: DeletionLoader;
	} = {}
): Promise<DirectResult> {
	const start = performance.now();
	let requests = 0;
	const paths = [...new Set(files.flatMap((file) => [file.path, ...file.selectedBy]))];
	for (let attempt = 0; attempt < 2; attempt++) {
		requests++;
		const snapshot = await readDirectSnapshot(client, target, paths);
		const changed = selectDirectFiles(files, snapshot, options.selection ?? "all");
		const deletion = options.loadDeletions
			? await options.loadDeletions(snapshot)
			: { paths: [], requests: 0 };
		requests += deletion.requests;
		const preparedPaths = new Set(files.map((file) => file.path));
		const deleted = [...new Set(deletion.paths)].filter(
			(path) => !preparedPaths.has(path)
		);
		if (!changed.length && !deleted.length) {
			return {
				uploaded: [],
				deleted: [],
				requests,
				elapsedMs: performance.now() - start,
			};
		}
		try {
			requests++;
			const response = await client.graphql<{
				createCommitOnBranch: { commit: { oid: string } };
			}>(
				"mutation DirectPublishCommit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
				{
					input: {
						branch: {
							repositoryNameWithOwner: target.owner + "/" + target.repo,
							branchName: target.branch.replace(/^refs\/heads\//, ""),
						},
						expectedHeadOid: snapshot.head,
						message: { headline: options.message?.trim() || "[PUBLISHER] Publish" },
						fileChanges: {
							additions: changed.map(({ path, contents }) => ({ path, contents })),
							deletions: deleted.map((path) => ({ path })),
						},
					},
				}
			);
			const commit = response.createCommitOnBranch?.commit?.oid;
			if (!commit) throw new Error("GitHub 未返回新提交，发布未确认完成。");
			return {
				commit,
				uploaded: changed.map((file) => ({
					path: file.path,
					isUpdated: snapshot.files.has(file.path),
				})),
				deleted,
				requests,
				elapsedMs: performance.now() - start,
			};
		} catch (error) {
			if (attempt === 0 && isHeadChangedError(error)) continue;
			throw error;
		}
	}
	throw new Error("目标分支持续变化，请重新发布。");
}
