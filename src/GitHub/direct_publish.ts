import type { Properties, Repository } from "@interfaces";
import i18next from "i18next";
import { type FrontMatterCache, Notice, Platform, type TFile } from "obsidian";
import { prepareAttachment } from "src/conversion/attachment";
import { ensureAbbrlink } from "src/conversion/article_links";
import { getImagePath, getReceiptFolder } from "src/conversion/file_path";
import type Enveloppe from "src/main";
import { ListChangedFiles } from "src/settings/modals/list_changed";
import { createListEdited, getSettingsOfMetadataExtractor } from "src/utils";
import { isAttachment, isShared } from "src/utils/data_validation_test";
import {
	frontmatterFromFile,
	frontmatterSettingsRepository,
	getProperties,
	mergeFrontmatter,
} from "src/utils/parse_frontmatter";
import { ShareStatusBar } from "src/utils/status_bar";
import type { GithubBranch } from "./branch";
import { checkIndexFiles, filterGithubFile } from "./delete";
import {
	addDirectFile,
	type DirectFile,
	type DirectResult,
	type DirectSelection,
	type DirectSnapshot,
	prepareDirectFile,
	publishDirectBatch,
} from "./direct";

export function useDirectPublish(plugin: Enveloppe): boolean {
	return (
		Boolean(plugin.settings.github.directPublish) && !plugin.settings.github.dryRun.enable
	);
}

interface DirectGroup {
	properties: Properties;
	repository: Repository | null;
	files: Map<string, DirectFile>;
	cleanup: Properties[];
}

export interface DirectPublicationReport {
	results: DirectResult[];
	requests: number;
	elapsedMs: number;
}

/** 复用现有转换，只在所有文件准备完成后才访问 GitHub。 */
export async function publishDirectFiles(
	publisher: GithubBranch,
	files: TFile[],
	repository: Repository | null,
	options: {
		selection?: DirectSelection;
		deepScan?: boolean;
		sourceFrontmatter?: FrontMatterCache | null;
		statusElement?: HTMLElement;
	} = {}
): Promise<DirectPublicationReport | null> {
	const { plugin } = publisher;
	const start = performance.now();
	const status = new ShareStatusBar(
		options.statusElement ?? plugin.addStatusBarItem(),
		files.length,
		false,
		plugin.console
	);
	const notification = new Notice(i18next.t("directPublish.checking"), 0);
	const groups = new Map<string, DirectGroup>();
	const attachments = new Map<TFile, Promise<Uint8Array<ArrayBuffer>>>();
	const seen = new Set<string>();

	const collect = async (file: TFile, selectedBy?: string): Promise<void> => {
		const frontmatter = mergeFrontmatter(
			frontmatterFromFile(file, plugin, repository),
			options.sourceFrontmatter,
			plugin.settings.plugin.shareKey
		);
		if (!isShared(frontmatter, plugin.settings, file, repository)) return;
		const targets = getProperties(plugin, repository, frontmatter);
		for (const prop of Array.isArray(targets) ? targets : [targets]) {
			const key = JSON.stringify([prop.owner, prop.repo, prop.branch]);
			const visit = JSON.stringify([
				key,
				file.path,
				selectedBy ?? getReceiptFolder(file, repository, plugin, prop),
			]);
			if (seen.has(visit)) continue;
			seen.add(visit);
			const prepared = await publisher.preparePublication(
				file,
				{ frontmatter: prop, repository },
				options.sourceFrontmatter,
				prop
			);
			if (!prepared) throw new Error("发布配置不完整：" + file.path);
			let group = groups.get(key);
			if (!group) {
				group = { properties: prop, repository, files: new Map(), cleanup: [] };
				groups.set(key, group);
			}
			if (
				prop.autoclean &&
				!group.cleanup.some(
					(scope) => JSON.stringify(scope.path) === JSON.stringify(prop.path)
				)
			) {
				group.cleanup.push(prop);
			}
			const root = selectedBy ?? prepared.path;
			addDirectFile(
				group.files,
				await prepareDirectFile(prepared.path, new TextEncoder().encode(prepared.text), [
					root,
				])
			);
			for (const attachment of prepared.embedFiles) {
				if (
					isAttachment(attachment.name, plugin.settings.embed.unHandledObsidianExt) &&
					prepared.general.attachment
				) {
					let bytes = attachments.get(attachment);
					if (!bytes) {
						bytes = prepareAttachment(attachment, plugin);
						attachments.set(attachment, bytes);
					}
					const path = getImagePath(attachment, plugin, prepared.general, prop);
					addDirectFile(group.files, await prepareDirectFile(path, await bytes, [root]));
				} else if (
					options.deepScan &&
					attachment.extension === "md" &&
					!attachment.name.includes("excalidraw")
				) {
					await collect(attachment, root);
				}
			}
		}
	};

	try {
		// 同批次先固定所有已选文章的编号，A 可以引用随后才转换的 B。
		for (const file of files) {
			if (
				isShared(
					frontmatterFromFile(file, plugin, repository),
					plugin.settings,
					file,
					repository
				)
			) {
				await ensureAbbrlink(file, plugin);
			}
		}
		for (const file of files) {
			await collect(file);
			status.increment();
		}
		if (
			plugin.settings.upload.metadataExtractorPath &&
			Platform.isDesktop &&
			groups.size
		) {
			const metadata = await getSettingsOfMetadataExtractor(plugin.app, plugin.settings);
			if (metadata) {
				for (const source of Object.values(metadata)) {
					if (!source) continue;
					const path =
						plugin.settings.upload.metadataExtractorPath + "/" + source.split("/").pop();
					const bytes = new TextEncoder().encode(
						await publisher.vault.adapter.read(source)
					);
					for (const group of groups.values()) {
						const roots = [
							...new Set([...group.files.values()].flatMap((file) => file.selectedBy)),
						];
						addDirectFile(group.files, await prepareDirectFile(path, bytes, roots));
					}
				}
			}
		}
		const results: DirectResult[] = [];
		for (const group of groups.values()) {
			const prop = group.properties;
			const configured = plugin.settings.github.otherRepo.find(
				(repo) =>
					repo.user === prop.owner &&
					repo.repo === prop.repo &&
					repo.branch === prop.branch
			);
			const client =
				configured && configured.smartKey !== repository?.smartKey
					? await plugin.reloadOctokit(configured.smartKey)
					: publisher;
			const result = await publishDirectBatch(
				client.octokit,
				prop,
				[...group.files.values()],
				{
					selection: options.selection,
					message: prop.commitMsg,
					loadDeletions: group.cleanup.length
						? (snapshot) => loadDirectDeletions(client, group, snapshot)
						: undefined,
				}
			);
			results.push(result);
			if (result.commit && prop.workflowName) await client.workflowGestion(prop);
		}
		const uploaded = results.flatMap((result) =>
			result.uploaded.map((file) => ({ file: file.path, isUpdated: file.isUpdated }))
		);
		const deleted = results.flatMap((result) => result.deleted);
		const requests = results.reduce((sum, result) => sum + result.requests, 0);
		const elapsedMs = performance.now() - start;
		notification.hide();
		status.finish(8000);
		new Notice(
			i18next.t(
				uploaded.length || deleted.length
					? "directPublish.success"
					: "directPublish.unchanged",
				{
					count: uploaded.length,
					deleted: deleted.length,
					requests,
					seconds: (elapsedMs / 1000).toFixed(2),
				}
			),
			publisher.noticeLength
		);
		plugin.console.debug("直提发布完成", {
			files: uploaded.length,
			deleted: deleted.length,
			requests,
			elapsedMs,
		});
		if (
			plugin.settings.plugin.displayModalRepoEditing &&
			(uploaded.length || deleted.length)
		) {
			new ListChangedFiles(
				plugin.app,
				createListEdited(uploaded, { success: true, deleted, undeleted: [] }, [])
			).open();
		}
		return { results, requests, elapsedMs };
	} catch (error) {
		notification.hide();
		const message = error instanceof Error ? error.message : String(error);
		status.error(
			groups.values().next().value?.properties ??
				getDefaultProperties(publisher, repository)
		);
		plugin.console.error(new Error(message));
		new Notice(i18next.t("directPublish.failed", { message }), publisher.noticeLength);
		return null;
	}
}

function getDefaultProperties(
	publisher: GithubBranch,
	repository: Repository | null
): Properties {
	const properties = getProperties(publisher.plugin, repository);
	return Array.isArray(properties) ? properties[0] : properties;
}

/** 用检查阶段固定的 tree/commit 读取，删除与文件更新进入同一次提交。 */
async function loadDirectDeletions(
	publisher: GithubBranch,
	group: DirectGroup,
	snapshot: DirectSnapshot
): Promise<{ paths: string[]; requests: number }> {
	const response = await publisher.octokit.request(
		"GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
		{
			owner: group.properties.owner,
			repo: group.properties.repo,
			tree_sha: snapshot.tree,
			recursive: "true",
		}
	);
	if (response.data.truncated) throw new Error("远端文件列表被截断，未执行清理。");
	const remote = response.data.tree.flatMap((entry) =>
		entry.type === "blob" && entry.path && entry.sha
			? [{ file: entry.path, sha: entry.sha }]
			: []
	);
	const converted = publisher.getAllFileWithPath(
		group.repository,
		frontmatterSettingsRepository(publisher.plugin, group.repository),
		true
	);
	let requests = 1;
	const paths = new Set<string>();
	for (const prop of group.cleanup) {
		const candidates = await filterGithubFile(remote, publisher.settings, prop);
		for (const file of candidates) {
			const isInVault = converted.some(
				(local) => local.converted === file.file || local.otherPaths?.includes(file.file)
			);
			const anotherRepo =
				file.file.endsWith(".md") &&
				!converted.some((local) => {
					const configured = Array.isArray(local.prop)
						? local.prop.find((target) => target.repo === prop.repo)
						: local.prop;
					return (
						(local.converted === file.file || local.otherPaths?.includes(file.file)) &&
						configured
					);
				});
			if (
				(isInVault && !anotherRepo) ||
				group.files.has(file.file) ||
				paths.has(file.file)
			)
				continue;
			if (file.file.includes(publisher.settings.upload.folderNote.rename)) {
				requests++;
				if (await checkIndexFiles(publisher.octokit, file.file, prop, snapshot.head))
					continue;
			}
			paths.add(file.file);
		}
	}
	return { paths: [...paths], requests };
}
