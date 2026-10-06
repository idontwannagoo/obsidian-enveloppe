const en = {
	contentDesc:
		"Content conversions apply to the published copy. Automatic abbrlink completion also saves the identifier to the local note.",
	templateTitle: "Article web link template",
	templateDesc:
		"Use the linked article’s frontmatter fields, e.g. /posts/{abbrlink}/. Leave empty to use repository file links.",
	autoTitle: "Fill abbrlink on first publication",
	autoDesc:
		"Generate a Hexo CRC16 identifier and save it to the local note when missing. Existing identifiers are preserved.",
	missingField:
		"{{file}} is missing {{field}}. Publish the target first or publish both articles together.",
	invalidTemplate: "The article link template must start with /, http:// or https://.",
	invalidYaml: "Invalid frontmatter in {{file}}.",
};
const zhCN: typeof en = {
	contentDesc:
		"内容转换作用于发布副本。启用自动补全 abbrlink 时，也会将编号保存到本地文章。",
	templateTitle: "文章网页链接模板",
	templateDesc:
		"读取目标文章的 frontmatter 字段，例如 /posts/{abbrlink}/。留空时使用原有仓库文件链接。",
	autoTitle: "首次发布时自动补全 abbrlink",
	autoDesc: "缺少编号时按 Hexo CRC16 算法生成并写回本地文章，已有编号保留。",
	missingField: "{{file}} 缺少 {{field}}，请先发布目标文章，或将两篇文章一起发布。",
	invalidTemplate: "文章网页链接模板需要以 /、http:// 或 https:// 开头。",
	invalidYaml: "{{file}} 的 frontmatter 格式无效。",
};
const zhTW: typeof en = {
	contentDesc:
		"內容轉換作用於發布副本。啟用自動補全 abbrlink 時，也會將編號儲存至本機文章。",
	templateTitle: "文章網頁連結模板",
	templateDesc:
		"讀取目標文章的 frontmatter 欄位，例如 /posts/{abbrlink}/。留空時使用原有儲存庫檔案連結。",
	autoTitle: "首次發布時自動補全 abbrlink",
	autoDesc: "缺少編號時按 Hexo CRC16 演算法產生並寫回本機文章，已有編號保留。",
	missingField: "{{file}} 缺少 {{field}}，請先發布目標文章，或將兩篇文章一起發布。",
	invalidTemplate: "文章網頁連結模板需要以 /、http:// 或 https:// 開頭。",
	invalidYaml: "{{file}} 的 frontmatter 格式無效。",
};
export function withArticleMessages<T>(locale: T, language: "en" | "zhCN" | "zhTW") {
	return { ...locale, articleLinks: { en, zhCN, zhTW }[language] };
}
