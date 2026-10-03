import { Base64 } from "js-base64";
import { gitBlobSha, type DirectClient } from "../src/GitHub/direct";

export class FakeGithub implements DirectClient {
	calls: { query: string; variables: Record<string, any> }[] = [];
	private states = new Map<string, { files: Map<string, string>; head: string }>();
	private state(key: string) {
		let state = this.states.get(key);
		if (!state) {
			state = { files: new Map(), head: "c100" };
			this.states.set(key, state);
		}
		return state;
	}
	get files() {
		return this.state("user/blog/master").files;
	}
	get head() {
		return this.state("user/blog/master").head;
	}
	set head(value: string) {
		this.state("user/blog/master").head = value;
	}
	input: any;
	restCalls: { route: string; variables: any }[] = [];
	contents = new Map<string, string>();
	async request(route: string, variables: any) {
		this.restCalls.push({ route, variables });
		if (route.includes("/git/trees/"))
			return {
				data: {
					truncated: false,
					tree: [...this.files].map(([path, sha]) => ({ path, sha, type: "blob" })),
				},
			};
		if (route.includes("/contents/"))
			return {
				status: 200,
				data: { content: Base64.encode(this.contents.get(variables.path) ?? "") },
			};
		throw new Error("出现预期之外的 REST 请求：" + route);
	}
	beforeCommit?: (input: any) => void;
	readError?: Error;
	async graphql<T>(query: string, variables: Record<string, any>): Promise<T> {
		this.calls.push({ query, variables });
		if (query.startsWith("query")) {
			if (this.readError) throw this.readError;
			const state = this.state(
				variables.owner +
					"/" +
					variables.repo +
					"/" +
					variables.ref.replace(/^refs\/heads\//, "")
			);
			const entriesFor = (directory: string) => {
				const prefix = directory ? directory + "/" : "";
				const entries = new Map<string, any>();
				for (const [path, sha] of state.files) {
					if (!path.startsWith(prefix)) continue;
					const rest = path.slice(prefix.length);
					const name = rest.split("/")[0];
					entries.set(name, {
						name,
						oid: rest.includes("/") ? "tree-" + name : sha,
						type: rest.includes("/") ? "tree" : "blob",
					});
				}
				return [...entries.values()];
			};
			const target: Record<string, any> = {
				oid: state.head,
				tree: { oid: "tree100", entries: entriesFor("") },
			};
			const missing: { type: string; path: string[] }[] = [];
			for (const match of query.matchAll(/(d\d+): file\(path: ("(?:[^"\\]|\\.)*")\)/g)) {
				const directory = JSON.parse(match[2]);
				const entries = entriesFor(directory);
				target[match[1]] = entries.length ? { type: "tree", object: { entries } } : null;
				if (!entries.length)
					missing.push({
						type: "NOT_FOUND",
						path: ["repository", "ref", "target", match[1]],
					});
			}
			const data = { repository: { ref: { target } } };
			if (missing.length)
				throw Object.assign(new Error("Could not resolve file for path"), {
					errors: missing,
					data,
				});
			return data as T;
		}
		this.input = variables.input;
		const state = this.state(
			this.input.branch.repositoryNameWithOwner + "/" + this.input.branch.branchName
		);
		this.beforeCommit?.(this.input);
		if (this.input.expectedHeadOid !== state.head)
			throw Object.assign(
				new Error("Expected branch to point to the previous commit but it did not"),
				{ errors: [{ type: "STALE_DATA" }] }
			);
		for (const file of this.input.fileChanges.additions)
			state.files.set(file.path, await gitBlobSha(Base64.toUint8Array(file.contents)));
		for (const file of this.input.fileChanges.deletions) state.files.delete(file.path);
		state.head += "x";
		return { createCommitOnBranch: { commit: { oid: state.head } } } as T;
	}
}
