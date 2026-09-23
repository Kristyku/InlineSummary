// SillyTavern - Inline Summary Extension - Settings

// =========================
// Constants
// =========================
const kDefaultSettings = Object.freeze({
	startPrompt: "Undefined",
	midPrompt: "",
	endPrompt: "",
	historicalContexDepth: -1,
	historicalContextStartMarker: "<Historical_Context>",
	historicalContextEndMarker: "</Historical_Context>",
	summariseStartMarker: "<Content_To_Summarise>",
	summariseEndMarker: "</Content_To_Summarise>",
	tokenLimit: 0,
	useDifferentProfile: false,
	profileName: "<None>",
	useDifferentApiPreset: false,
	apiPresets: {},
	autoScroll: true,
	regexPreGenerate: false,
	regexPostGenerate: false,
	useMultiMessage: false,
	summaryNameMode: "custom",
	summaryName: "Summary",
	doLegacyRecovery: true,
});

// =========================
// Includes/API/Globals
// =========================

import { POPUP_RESULT, Popup } from '../../../../scripts/popup.js';
import { download, getSanitizedFilename } from '../../../../scripts/utils.js';

import
{
	kExtensionName,
	kDefaultsFile,
	GetILSInstance,
	ShowError,
	ShowWarning,
	Debounce
} from './common.js';

let gSettings = {};
let gAltSettings = [null, null];
export let gSpName = "Default";
const kNotUsedPreset = "<Not Used>";

export function GetCurrentSettings(index)
{
	if (Number.isInteger(index) && index >= 1)
		return gAltSettings[index - 1] ?? gSettings;

	return gSettings;
}

export function IsAlternativeSettingsUsed(index)
{
	return Number.isInteger(index) && index >= 1 && gAltSettings[index - 1] != null;
}

export function GetCurrentSettingsName()
{
	return gSpName;
}

// =========================
// Settings Main
// =========================

export async function LoadSettings(stContext, index)
{
	// Get or Initialise root settings
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];

	// Get Settings name
	const isAlternative = Number.isInteger(index) && index >= 1;
	rootSettings.altSpNames ??= [null, null];
	let settingPresetName = isAlternative ? rootSettings.altSpNames[index - 1] : rootSettings.spName;
	if (!settingPresetName || settingPresetName === kNotUsedPreset)
	{
		if (isAlternative)
			gAltSettings[index - 1] = null;
		else
			settingPresetName = "Default";

		if (!isAlternative)
			rootSettings.spName = settingPresetName;

		if (isAlternative)
			return [gSettings, gSpName];
	}
	if (isAlternative && settingPresetName !== "Default" && !rootSettings.spData?.[settingPresetName])
	{
		rootSettings.altSpNames[index - 1] = null;
		gAltSettings[index - 1] = null;
		return [gSettings, gSpName];
	}

	if (!isAlternative)
		rootSettings.spName = settingPresetName;

	let activeSettings = rootSettings;

	// Ensure Presets initialized when not using Default.
	if (settingPresetName !== "Default")
	{
		rootSettings.spData ??= {};
		rootSettings.spData[settingPresetName] ??= {};
		activeSettings = rootSettings.spData[settingPresetName];
	}

	const defaultsJson = await $.get(kDefaultsFile);
	for (const settingKey of Object.keys(kDefaultSettings))
	{
		if (Object.hasOwn(activeSettings, settingKey))
			continue;

		switch (settingKey)
		{
			case "startPrompt":
				activeSettings.startPrompt = defaultsJson.defaultPrompt;
				break;

			default:
				activeSettings[settingKey] = kDefaultSettings[settingKey];
				break;
		}
	}

	if (isAlternative)
	{
		gAltSettings[index - 1] = activeSettings;
	}
	else
	{
		gSettings = activeSettings;
	}
	if (!isAlternative)
		gSpName = settingPresetName;

	return [gSettings, gSpName];
}

export function GetPresetSettings(stContext, presetName)
{
	// Get or Initialise root settings
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];

	if (rootSettings.spData && rootSettings.spData[presetName])
		return rootSettings.spData[presetName];

	return null;
}

export async function SwapProfile(profileName)
{
	const stContext = SillyTavern.getContext();

	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = profileName;

	// Reload
	await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

export async function OnSettingChanged(event)
{
	const stContext = SillyTavern.getContext();
	const id = event.target.id;
	const val = event.target.value;

	switch (id)
	{
		case "ils_setting_sp_combo":
			SwapProfile(val);
			break;
		case "ils_setting_alt_sp_combo_1":
		case "ils_setting_alt_sp_combo_2":
			{
				const index = id.endsWith("_1") ? 1 : 2;
				stContext.extensionSettings[kExtensionName] ??= {};
				const rootSettings = stContext.extensionSettings[kExtensionName];
				rootSettings.altSpNames ??= [null, null];
				rootSettings.altSpNames[index - 1] = val === kNotUsedPreset ? null : val;
				await LoadSettings(stContext, index);
				document.dispatchEvent(new Event("ils-settings-changed"));
			}
			break;
		case "ils_setting_hist_ctx_depth":
			{
				const parsed = parseInt(val, 10);
				gSettings.historicalContexDepth = Number.isNaN(parsed) ? -1 : parsed;
			}
			break;
		case "ils_setting_token_limit":
			{
				const parsed = parseInt(val, 10);
				gSettings.tokenLimit = Number.isNaN(parsed) ? 0 : parsed;
			}
			break;
		case "ils_setting_hist_ctx_start":
			gSettings.historicalContextStartMarker = val;
			break;
		case "ils_setting_hist_ctx_end":
			gSettings.historicalContextEndMarker = val;
			break;
		case "ils_setting_summ_cont_start":
			gSettings.summariseStartMarker = val;
			break;
		case "ils_setting_summ_cont_end":
			gSettings.summariseEndMarker = val;
			break;
		case "ils_setting_prompt_main":
			gSettings.startPrompt = val;
			break;
		case "ils_setting_prompt_mid":
			gSettings.midPrompt = val;
			break;
		case "ils_setting_prompt_end":
			gSettings.endPrompt = val;
			break;
		case "ils_setting_use_different_profile":
			gSettings.useDifferentProfile = event.target.checked;
			break;
		case "ils_setting_connection_profile":
			gSettings.profileName = val;
			break;
		case "ils_setting_use_specified_api_preset":
			gSettings.useDifferentApiPreset = event.target.checked;
			break;
		case "ils_setting_chat_completion_preset":
			{
				const apiMode = stContext.mainApi?.toLowerCase();
				gSettings.apiPresets ??= {};
				gSettings.apiPresets[apiMode] = val;
			}
			break;
		case "ils_setting_auto_scroll":
			gSettings.autoScroll = event.target.checked;
			break;
		case "ils_setting_enable_regex_pre_generate":
			gSettings.regexPreGenerate = event.target.checked;
			break;
		case "ils_setting_enable_regex_post_generate":
			gSettings.regexPostGenerate = event.target.checked;
			break;
		case "ils_setting_enable_multi_msg_prompt":
			gSettings.useMultiMessage = event.target.checked;
			break;
		case "ils_setting_smr_name_mode_user":
		case "ils_setting_smr_name_mode_char":
		case "ils_setting_smr_name_mode_custom":
			{
				const selected = document.querySelector('input[name="ils_setting_radio_smr_name"]:checked');
				if (selected)
					gSettings.summaryNameMode = selected.value;
			}
			break;
		case "ils_setting_smr_name_custom_val":
			gSettings.summaryName = val;
			break;
		case "ils_setting_do_legacy_recovery":
			gSettings.doLegacyRecovery = event.target.checked;
			break;
		default:
			return; // unknown setting
	}

	stContext.saveSettingsDebounced();
}

export async function OnSettingSpNew()
{
	const stContext = SillyTavern.getContext();

	const nameInput = await Popup.show.input("New Preset", "Enter preset name:", "");
	if (!nameInput || nameInput.length == 0)
		return;

	const spName = (await getSanitizedFilename(nameInput)).trim();
	if (!spName || spName.length == 0)
		return;

	// Create new Entry
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = spName;
	rootSettings.spData ??= {};
	rootSettings.spData[rootSettings.spName] = {};

	// Reload
	await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

export async function OnSettingSpDelete()
{
	if (gSpName === "Default")
	{
		ShowError("'Default' settings preset cannot be deleted.");
		return;
	}

	const confirm = await Popup.show.confirm("Confirmation", "Are you use you want to delete '" + gSpName + "'?");
	if (confirm !== POPUP_RESULT.AFFIRMATIVE)
		return;

	const spName = gSpName;

	const stContext = SillyTavern.getContext();

	// Set active preset to default
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = "Default";

	// Reload settings
	await LoadSettings(stContext);

	// Delete old preset
	delete rootSettings.spData[spName];
	rootSettings.altSpNames ??= [null, null];
	for (let index = 0; index < rootSettings.altSpNames.length; ++index)
	{
		if (rootSettings.altSpNames[index] === spName)
		{
			rootSettings.altSpNames[index] = null;
			gAltSettings[index] = null;
		}
	}

	// Refresh
	stContext.saveSettingsDebounced();
	document.dispatchEvent(new Event("ils-settings-changed"));
	UpdateSettingsUI();
}

export async function OnSettingSpImportFile(e)
{
	if (!(e.target instanceof HTMLInputElement))
		return;

	if (!e.target.files.length)
		return;

	const file = e.target.files[0];
	const fullName = file.name;

	if (!fullName.toLowerCase().endsWith(".json"))
	{
		ShowError("Please pick a json file.")
		return;
	}

	const stContext = SillyTavern.getContext();
	let baseName = fullName.slice(0, -5);

	let data = {};

	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spData ??= {};

	if (rootSettings.spData[baseName] || baseName === "Default")
	{
		let i = 1;
		while (rootSettings.spData[`${baseName} (${i})`])
			++i;

		baseName = `${baseName} (${i})`;
	}

	try
	{
		const text = await file.text();
		data = JSON.parse(text);
	}
	catch (err)
	{
		console.error("Failed to read or parse file:", err);
	}

	let newSettings = {};
	Object.keys(data).forEach(key => { if (Object.hasOwn(kDefaultSettings, key)) newSettings[key] = data[key]; });
	rootSettings.spData[baseName] = newSettings;
	rootSettings.spName = baseName;

	// Reload
	await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

export async function OnSettingSpExport()
{
	let settings = {};
	Object.keys(gSettings).forEach(key => { if (Object.hasOwn(kDefaultSettings, key)) settings[key] = gSettings[key]; });
	download(JSON.stringify(settings, null, "\t"), gSpName + ".json", "application/json");
}

export async function OnSettingSpResetToDefault()
{
	const confirm = await Popup.show.confirm("Confirmation", "Are you use you reset '" + gSpName + "' to default settings?");
	if (confirm !== POPUP_RESULT.AFFIRMATIVE)
		return;

	const stContext = SillyTavern.getContext();

	// Delete Keys, except for preset specific ones
	const keysToKeep = gSpName === "Default" ? new Set(["spName", "spData"]) : new Set();
	Object.keys(gSettings).forEach(key => { if (!keysToKeep.has(key)) delete gSettings[key]; });

	// Reload
	await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

async function OnSettingSpImportClick()
{
	$('#ils_setting_sp_import_file').trigger('click');
}

export async function UpdateSettingsUI()
{
	const stContext = SillyTavern.getContext();
	const ilsInstance = GetILSInstance();

	$("#ils_setting_hist_ctx_depth").val(gSettings.historicalContexDepth);
	$("#ils_setting_hist_ctx_start").val(gSettings.historicalContextStartMarker);
	$("#ils_setting_hist_ctx_end").val(gSettings.historicalContextEndMarker);
	$("#ils_setting_summ_cont_start").val(gSettings.summariseStartMarker);
	$("#ils_setting_summ_cont_end").val(gSettings.summariseEndMarker);
	$("#ils_setting_prompt_main").val(gSettings.startPrompt);
	$("#ils_setting_prompt_mid").val(gSettings.midPrompt);
	$("#ils_setting_prompt_end").val(gSettings.endPrompt);
	$("#ils_setting_token_limit").val(gSettings.tokenLimit);
	$("#ils_setting_smr_name_custom_val").val(gSettings.summaryName);
	$("#ils_setting_auto_scroll").prop("checked", gSettings.autoScroll);
	$("#ils_setting_enable_regex_pre_generate").prop("checked", gSettings.regexPreGenerate);
	$("#ils_setting_enable_regex_post_generate").prop("checked", gSettings.regexPostGenerate);
	$("#ils_setting_enable_multi_msg_prompt").prop("checked", gSettings.useMultiMessage);
	$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
	$("#ils_setting_use_specified_api_preset").prop("checked", gSettings.useDifferentApiPreset);
	$("#ils_setting_do_legacy_recovery").prop("checked", gSettings.doLegacyRecovery);

	const radio = document.querySelector(`input[name="ils_setting_radio_smr_name"][value="${gSettings.summaryNameMode}"]`);
	if (radio)
		radio.checked = true;

	const spDropdown = $("#ils_setting_sp_combo");
	if (spDropdown && spDropdown.length)
	{
		spDropdown.empty();
		spDropdown.append($('<option>', { value: 'Default', text: 'Default' }));

		stContext.extensionSettings[kExtensionName] ??= {};
		let rootSettings = stContext.extensionSettings[kExtensionName];
		rootSettings.spData ??= {};

		for (const [custompreset] of Object.entries(rootSettings.spData))
		{
			spDropdown.append($('<option>', { value: custompreset, text: custompreset }));
		}
		spDropdown.val(gSpName);

		rootSettings.altSpNames ??= [null, null];
		for (let index = 1; index <= 2; ++index)
		{
			const altDropdown = $(`#ils_setting_alt_sp_combo_${index}`);
			altDropdown.empty();
			altDropdown.append($('<option>', { value: kNotUsedPreset, text: kNotUsedPreset }));
			altDropdown.append($('<option>', { value: 'Default', text: 'Default' }));
			for (const [custompreset] of Object.entries(rootSettings.spData))
				altDropdown.append($('<option>', { value: custompreset, text: custompreset }));
			altDropdown.val(rootSettings.altSpNames[index - 1] ?? kNotUsedPreset);
		}
	}

	// Check for Regex extension
	const regexRes = await stContext.executeSlashCommandsWithOptions("/extension-state regex");
	if (regexRes.pipe != "true")
	{
		$("#ils_setting_enable_regex_pre_generate").prop("disabled", true);
		$("#ils_setting_enable_regex_post_generate").prop("disabled", true);
		ilsInstance.regexEnabled = false;
	}
	else
	{
		ilsInstance.regexEnabled = true;
	}

	// Do Connection Profile stuff last so we can early return on errors
	const connectionManagerRes = await stContext.executeSlashCommandsWithOptions("/extension-state connection-manager");
	if (connectionManagerRes.pipe != "true")
	{
		$("#ils_setting_use_different_profile").prop("disabled", true);
		$("#ils_setting_use_specified_api_preset").prop("disabled", true);
		$("#ils_setting_connection_profile").prop("disabled", true);
		$("#ils_setting_chat_completion_preset").prop("disabled", true);

		ilsInstance.connProfEnabled = false;
		return;
	}
	else
	{
		ilsInstance.connProfEnabled = true;
	}

	let profileListRes = null;
	try
	{
		profileListRes = await stContext.executeSlashCommandsWithOptions("/profile-list", { handleParserErrors: false });
	}
	catch (e)
	{
		ShowError("Failed to run '/profile-list'.\nIs the 'Connection Profiles' extension enabled?", e);
		return;
	}

	if (profileListRes == null || profileListRes.isError)
	{
		ShowError("Failed to fetch Connection Profile list.");
		return;
	}

	try
	{
		const profileDropdown = $("#ils_setting_connection_profile");
		if (profileDropdown && profileDropdown.length)
		{
			profileDropdown.empty();
			profileDropdown.append($('<option>', { value: '<None>', text: '<None>' }));

			const profileList = JSON.parse(profileListRes.pipe);

			if (Array.isArray(profileList))
			{
				for (const profName of profileList)
					profileDropdown.append($('<option>', { value: profName, text: profName }));
			}

			if (gSettings.profileName && gSettings.profileName !== "" && profileList && profileList.includes(gSettings.profileName))
			{
				profileDropdown.val(gSettings.profileName);
			}
			else if (gSettings.profileName !== "<None>")
			{
				if (gSettings.useDifferentProfile)
				{
					gSettings.useDifferentProfile = false;
					$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
					profileDropdown.val("<None>");
					stContext.saveSettingsDebounced();
					ShowWarning("Selected Connection Profile: '" + gSettings.profileName + "' not found.\nUsing different profile has been disabled and reverted to <None>.");
				}
			}
		}
	}
	catch (e)
	{
		ShowError("Failed to populate connection profile dropdown.", e)
	}

	const presetManager = stContext.getPresetManager();
	const apiMode = stContext.mainApi?.toLowerCase();

	try
	{
		const presetDropdown = $("#ils_setting_chat_completion_preset");
		if (presetDropdown && presetDropdown.length)
		{
			presetDropdown.empty();

			const presetNames = presetManager.getPresetList().preset_names;
			const presetList = Object.keys(presetNames);
			const presetName = gSettings?.apiPresets?.[apiMode] ?? "";

			switch (apiMode)
			{
				case "textgenerationwebui":
					{
						// Text Gen is 'Int - Name' pairs
						for (const presetId of presetList)
							presetDropdown.append($('<option>', { value: presetNames[presetId], text: presetNames[presetId] }));
					}
					break;
				case "openai":
				case "novel":
				case "koboldhorde":
				case "kobold":
					{
						// These APIs are  'Name - Int' pairs
						for (const presName of presetList)
							presetDropdown.append($('<option>', { value: presName, text: presName }));
					}
					break;
				default:
					ShowError("Unknow API Mode: " + apiMode);
					break
			}

			if (presetName != "" && presetList.includes(presetName))
			{
				presetDropdown.val(presetName);
			}
			else
			{
				if (gSettings.useDifferentApiPreset)
				{
					gSettings.useDifferentApiPreset = false;
					$("#ils_setting_use_specified_api_preset").prop("checked", gSettings.useDifferentApiPreset);
					stContext.saveSettingsDebounced();
					ShowWarning("Selected API Preset (" + apiMode + "): '" + presetName + "' not found.\nUsing different preset has been disabled.");
				}
			}
		}
	}
	catch (e)
	{
		ShowError("Failed to populate Preset dropdown.", e);
	}
}

export function SetupOnSettingChangeEvents()
{
	// Setup setting change handlers
	$("#ils_setting_sp_combo").on("input", OnSettingChanged);
	$("#ils_setting_alt_sp_combo_1").on("change", OnSettingChanged);
	$("#ils_setting_alt_sp_combo_2").on("change", OnSettingChanged);
	$("#ils_setting_hist_ctx_depth").on("input", OnSettingChanged);
	$("#ils_setting_hist_ctx_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_hist_ctx_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_main").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_mid").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_smr_name_custom_val").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_token_limit").on("input", OnSettingChanged);
	$("#ils_setting_use_different_profile").on("change", OnSettingChanged);
	$("#ils_setting_connection_profile").on("input", OnSettingChanged);
	$("#ils_setting_use_specified_api_preset").on("change", OnSettingChanged);
	$("#ils_setting_chat_completion_preset").on("input", OnSettingChanged);
	$("#ils_setting_smr_name_mode_user").on("change", OnSettingChanged);
	$("#ils_setting_smr_name_mode_char").on("change", OnSettingChanged);
	$("#ils_setting_smr_name_mode_custom").on("change", OnSettingChanged);
	$("#ils_setting_auto_scroll").on("change", OnSettingChanged);
	$("#ils_setting_enable_regex_pre_generate").on("change", OnSettingChanged);
	$("#ils_setting_enable_regex_post_generate").on("change", OnSettingChanged);
	$("#ils_setting_enable_multi_msg_prompt").on("change", OnSettingChanged);

	$("#ils_setting_sp_new").on("click", OnSettingSpNew);
	$("#ils_setting_sp_delete").on("click", OnSettingSpDelete);
	$("#ils_setting_sp_import").on("click", OnSettingSpImportClick);
	$("#ils_setting_sp_export").on("click", OnSettingSpExport);
	$("#ils_setting_sp_reset_default").on("click", OnSettingSpResetToDefault);

	$("#ils_setting_sp_import_file").on("change", OnSettingSpImportFile);
}
