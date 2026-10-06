import type { LinkedNotes, MultiProperties } from "@interfaces";
import i18next from "i18next";
import {
	getFrontMatterInfo,
	parseYaml,
	type FrontMatterCache,
	type TFile,
} from "obsidian";
import type Enveloppe from "src/main";
import { checkIfRepoIsInAnother, isShared } from "src/utils/data_validation_test";
import { frontmatterFromFile, getProperties } from "src/utils/parse_frontmatter";

/** 与 hexo-abbrlink 2.2.1 的 UTF-8 CRC16 保持一致。 */
export function crc16(title: string): number {
	let crc = 0;
	for (const byte of new TextEncoder().encode(title)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
	}
	return crc;
}

export function hasAbbrlink(value: unknown): boolean {
	return value !== undefined && value !== null && String(value).trim() !== "";
}

/** 读文件取得刚写入的字段，不等待 Obsidian 元数据缓存刷新。 */
export async function readArticle(file: TFile, plugin: Enveloppe) {
	const text = await plugin.app.vault.read(file);
	const info = getFrontMatterInfo(text);
	const frontmatter = (info.exists ? parseYaml(info.frontmatter) : {}) ?? {};
	if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
		throw new Error(i18next.t("articleLinks.invalidYaml", { file: file.path }));
	}
	return { text, frontmatter: frontmatter as FrontMatterCache };
}

// 仅在当前进程中串行化编号分配，并保留缓存尚未刷新时的占用编号。
const allocations = new WeakMap<
	Enveloppe,
	{ tail: Promise<unknown>; reserved: Set<string> }
>();

export async function ensureAbbrlink(file: TFile, plugin: Enveloppe) {
	if (
		!plugin.settings.conversion.links.autoAbbrlink ||
		plugin.settings.github.dryRun.enable
	)
		return;
	let state = allocations.get(plugin);
	if (!state) {
		state = { tail: Promise.resolve(), reserved: new Set() };
		allocations.set(plugin, state);
	}
	const current = state;
	const task = current.tail.then(async () => {
		const article = await readArticle(file, plugin);
		if (hasAbbrlink(article.frontmatter.abbrlink)) {
			current.reserved.add(String(article.frontmatter.abbrlink));
			return article;
		}
		for (const note of plugin.app.vault.getMarkdownFiles()) {
			const value = plugin.app.metadataCache.getFileCache(note)?.frontmatter?.abbrlink;
			if (hasAbbrlink(value)) current.reserved.add(String(value));
		}
		await plugin.app.fileManager.processFrontMatter(file, (value) => {
			const frontmatter = value as Record<string, unknown>;
			// 写入操作内再次判断，保留编辑器或另一发布操作刚添加的编号。
			if (!hasAbbrlink(frontmatter.abbrlink)) {
				let id = crc16(String(frontmatter.title ?? file.basename));
				// Hexo 将数值 0 视为缺失编号，因此不生成 0。
				while (id === 0 || current.reserved.has(String(id))) id++;
				frontmatter.abbrlink = id;
			}
			current.reserved.add(String(frontmatter.abbrlink));
		});
		return readArticle(file, plugin);
	});
	current.tail = task.catch(() => undefined);
	return task;
}

/** 只映射同一发布目标中的普通文章引用，附件和嵌入继续沿用原转换。 */
export async function articleWebLink(
	link: LinkedNotes,
	properties: MultiProperties
): Promise<string | null> {
	const { plugin } = properties;
	const template = plugin.settings.conversion.links.webTemplate?.trim();
	if (
		!template ||
		link.type !== "link" ||
		link.linked.extension !== "md" ||
		link.linked.name.includes("excalidraw")
	)
		return null;
	const article = await readArticle(link.linked, plugin);
	const frontmatter = {
		...frontmatterFromFile(link.linked, plugin, properties.repository),
		...article.frontmatter,
	};
	if (
		!isShared(frontmatter, plugin.settings, link.linked, properties.repository) ||
		!checkIfRepoIsInAnother(
			properties.frontmatter.prop,
			getProperties(plugin, properties.repository, frontmatter)
		)
	)
		return null;
	const url = template.replace(/\{([\w.-]+)\}/g, (_match, key: string) => {
		const value = frontmatter[key];
		if (
			value === undefined ||
			value === null ||
			String(value).trim() === "" ||
			(typeof value !== "string" && typeof value !== "number")
		) {
			throw new Error(
				i18next.t("articleLinks.missingField", { file: link.linked.path, field: key })
			);
		}
		return encodeURIComponent(String(value));
	});
	if ((!url.startsWith("/") || url.startsWith("//")) && !/^https?:\/\//i.test(url)) {
		throw new Error(i18next.t("articleLinks.invalidTemplate"));
	}
	return url;
}
