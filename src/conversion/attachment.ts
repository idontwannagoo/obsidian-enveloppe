import type { TFile } from "obsidian";
import type Enveloppe from "src/main";
import { convertToHTMLSVG } from "./compiler/excalidraw";

/** 准备实际上传的附件字节；SVG 转换同样适用于移动端。 */
export async function prepareAttachment(
	file: TFile,
	plugin: Enveloppe
): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = new Uint8Array(await plugin.app.vault.readBinary(file));
	if (file.name.includes("excalidraw")) {
		const svg = await convertToHTMLSVG(file, plugin.app);
		if (svg) return new TextEncoder().encode(svg);
	}
	return bytes;
}
