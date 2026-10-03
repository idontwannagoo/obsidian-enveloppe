type DirectMessages = {
	mergeTitle: string;
	title: string;
	desc: string;
	checking: string;
	unchanged: string;
	success: string;
	failed: string;
};

const en: DirectMessages = {
	mergeTitle: "Automatically merge pull requests",
	title: "Commit directly to the target branch",
	desc: "Compare published content and commit changes in one batch. Automatic PR merging is unavailable in this mode.",
	checking: "Preparing files and checking GitHub content…",
	unchanged: "No content changes to publish.",
	success:
		"Published {{count}} files and removed {{deleted}} files ({{requests}} requests, {{seconds}} s).",
	failed: "Direct publishing failed: {{message}}",
};
const zhCN: DirectMessages = {
	mergeTitle: "自动合并 PR",
	title: "直接提交到目标分支",
	desc: "比较实际发布内容，将变化一次批量提交。开启后自动合并 PR 控件不可操作。",
	checking: "正在准备文件并检查 GitHub 内容…",
	unchanged: "内容没有变化，无需发布。",
	success:
		"已发布 {{count}} 个文件、删除 {{deleted}} 个文件（{{requests}} 次请求，{{seconds}} 秒）。",
	failed: "直接发布失败：{{message}}",
};
const zhTW: DirectMessages = {
	mergeTitle: "自動合併 PR",
	title: "直接提交到目標分支",
	desc: "比較實際發布內容，將變更一次批次提交。啟用後自動合併 PR 控制項不可操作。",
	checking: "正在準備檔案並檢查 GitHub 內容…",
	unchanged: "內容沒有變更，無需發布。",
	success:
		"已發布 {{count}} 個檔案、刪除 {{deleted}} 個檔案（{{requests}} 次請求，{{seconds}} 秒）。",
	failed: "直接發布失敗：{{message}}",
};

/** 在主仓库扩展翻译，保持翻译子模块的固定版本。 */
export function withDirectMessages<T extends { settings: { github: object } }>(
	locale: T,
	language: "en" | "zhCN" | "zhTW"
) {
	const messages = { en, zhCN, zhTW }[language];
	return {
		...locale,
		settings: {
			...locale.settings,
			github: {
				...locale.settings.github,
				automaticallyMergePR: messages.mergeTitle,
				directPublish: { title: messages.title, desc: messages.desc },
			},
		},
		directPublish: messages,
	};
}
