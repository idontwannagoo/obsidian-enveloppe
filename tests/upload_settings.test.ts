import { beforeAll, expect, test } from "bun:test";
import i18next from "i18next";
import { resources } from "../src/i18n/i18next";
import { FolderSettings } from "../src/interfaces/enum";
import Enveloppe from "../src/main";
import { renderUploadConfiguration } from "../src/settings/renders/upload";
import { hideSettings, showSettings } from "../src/settings/style";
import { fixture } from "./fixture";
import { FakeElement, FakeSetting } from "./preload";

beforeAll(async () => {
	await i18next.init({ lng: "zhCN", fallbackLng: "en", resources });
});

test("设置存在空的内部字段时，只控制公开的行元素", () => {
	const settingEl = { style: { display: "" }, show() {}, hide() {} };
	const setting = { settingEl, components: [], headingEl: null } as any;
	hideSettings(setting);
	expect(settingEl.style.display).toBe("none");
	showSettings(setting);
	expect(settingEl.style.display).toBe("");
});

function render(f: ReturnType<typeof fixture>, rerender: () => Promise<void>) {
	FakeSetting.items = [];
	renderUploadConfiguration({
		plugin: f.plugin,
		app: f.app,
		settings: f.settings,
		settingsPage: new FakeElement(),
		renderSettingsPage: rerender,
		copy: structuredClone,
	} as any);
	return FakeSetting.items.find(
		(x) => x.name === i18next.t("settings.upload.folderBehavior.title")
	)!.control!;
}

test("完整渲染文件路径页面，Property key 保存后重载仍然保留，排除规则不变", async () => {
	const f = fixture();
	f.settings.upload.autoclean.enable = true;
	f.settings.upload.autoclean.excluded = ["/^(?!source\\/_posts\\/).*/"];
	let saved = "";
	let renders = 0;
	f.plugin.saveSettings = async () => {
		saved = JSON.stringify(f.settings);
	};
	const dropdown = render(f, async () => {
		renders++;
	});
	expect(
		FakeSetting.items.some(
			(x) => x.name === i18next.t("settings.githubWorkflow.excludedFiles.title")
		)
	).toBe(true);
	await dropdown.change("yaml");
	expect(JSON.parse(saved).upload.behavior).toBe("yaml");
	expect(renders).toBe(1);
	const reloaded = new Enveloppe(f.app as any, {} as any);
	reloaded.loadData = async () => JSON.parse(saved);
	await reloaded.loadSettings();
	expect(reloaded.settings.upload.behavior).toBe(FolderSettings.Yaml);
	expect(reloaded.settings.upload.autoclean.excluded).toEqual(
		f.settings.upload.autoclean.excluded
	);
});

test("重新渲染出错时，选择的模式已经保存到磁盘数据", async () => {
	const f = fixture();
	let saved = "";
	f.plugin.saveSettings = async () => {
		saved = JSON.stringify(f.settings);
	};
	const dropdown = render(f, async () => {
		throw new Error("页面渲染失败");
	});
	await expect(dropdown.change("yaml")).rejects.toThrow("页面渲染失败");
	expect(JSON.parse(saved).upload.behavior).toBe("yaml");
});
