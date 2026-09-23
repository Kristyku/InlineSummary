// SillyTavern - Inline Summary Extension

// =========================
// Constants
// =========================
const kMsgBtnColours = {
	default: null,
	selected: "#4CAF50",
	alt1: "#54e0d9",
	alt2: "#ecc7ec",
	between: "#FFEB3B",
	clearable: "#2196F3",
};

const kDepthColours = [
	"#FF9AA2",
	"#FFB347",
	"#FFF275",
	"#B5E550",
	"#8EE5D8",
	"#89CFF0",
	"#A28CFF",
	"#FFB7CE",
	"#C7FF8F",
];

// =========================
// Includes/API/Globals
// =========================

import { getGeneratingApi, getGeneratingModel, this_chid, system_avatar, default_avatar } from "../../../../script.js";
import { timestampToMoment } from '../../../../scripts/utils.js';
import { getMessageTimeStamp } from '../../../../scripts/RossAscends-mods.js';
import { power_user } from '../../../../scripts/power-user.js';
import { getRegexedString, regex_placement } from "../../../extensions/regex/engine.js";

import
{
	kSettingsFile,
	kExtraDataKey,
	kOriginalMessagesKey,
	kMessageEstimatedTokenCountKey,
	ShowError,
	ShowWarning,
	Sleep,
	SafeJsonStringify,
	GetILSInstance,
	IsOperationLockEngaged,
	GetMessageByIndex
} from './common.js';

import
{
	GetCurrentSettings,
	IsAlternativeSettingsUsed,
	LoadSettings,
	UpdateSettingsUI,
	SetupOnSettingChangeEvents
} from './settings.js'

import
{
	MakeSummaryPrompt,
	StartGenerate,
	FinishGenerate,
} from './generate.js'

// =========================
// Helpers
// =========================
function GetDepthColour(depth)
{
	return kDepthColours[depth % kDepthColours.length];
}

function GetDepthColourWithAlpha(depth, alpha)
{
	const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0").toUpperCase();
	return GetDepthColour(depth) + alphaHex;
}

function MakeSpinner()
{
	const spinner = document.createElement("div");
	spinner.className = "ils_loading_spinner";
	spinner.innerHTML = '<i class="fa-solid fa-spinner"></i>';

	return spinner;
}

async function SaveAndReloadChat(stContext, errorMsg = null)
{
	try
	{
		await stContext.saveChat();
		await stContext.reloadCurrentChat();
	}
	catch (e)
	{
		if (errorMsg)
			ShowError(errorMsg);

		return false;
	}

	return true;
}

// =========================
// Selection Helpers
// =========================
function GetSelection(stContext)
{
	if (!stContext.chatMetadata.ils_selection)
		stContext.chatMetadata.ils_selection = { start: null, end: null };
	return stContext.chatMetadata.ils_selection;
}

function ClearSelection(stContext, refresh = true)
{
	stContext.chatMetadata.ils_selection = { start: null, end: null };
	if (refresh)
		RefreshAllMessageButtons();
}

function IsMsgInRange(msgIndex, selection)
{
	return selection.start !== null
		&& selection.end !== null
		&& msgIndex >= selection.start
		&& msgIndex <= selection.end;
}

function IsValidRangeSelection(selection)
{
	return selection.start !== null
		&& selection.end !== null
		&& (selection.end - selection.start) >= 0;
}

// =========================
// Legacy Functions
// =========================

function HasLegacyOriginalMessages(msgObject)
{
	return msgObject && msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]);
}

function RecoverOldData(msgObject)
{
	if (HasLegacyOriginalMessages(msgObject))
	{
		msgObject[kExtraDataKey] = msgObject.extra[kExtraDataKey];
		delete msgObject.extra[kExtraDataKey];

		for (const swipe of msgObject.swipe_info)
		{
			delete swipe.extra[kExtraDataKey];
		}

		const originalMessges = msgObject[kExtraDataKey][kOriginalMessagesKey] ?? null;
		if (originalMessges)
		{
			for (let msg of originalMessges)
			{
				RecoverOldData(msg);
			}
		}

		return true;
	}

	return false;
}

// =========================
// Chat Message Functions
// =========================

function HasOriginalMessages(msgObject)
{
	return msgObject && msgObject[kExtraDataKey] && Array.isArray(msgObject[kExtraDataKey][kOriginalMessagesKey]);
}

async function CreateEmptySummaryMessage(originalMessages, stContext, ilsSettings)
{
	const summary = {
		is_user: false,
		is_system: false,
		mes: "Generating...",
		extra: {}
	};

	switch (ilsSettings.summaryNameMode)
	{
		case "user":
			summary.name = stContext.name1;
			summary.is_user = true;
			break;
		case "character":
			summary.name = stContext.name2;
			break;
		case "custom":
		default:
			summary.name = ilsSettings.summaryName;
			break;
	}

	// Store original messages
	summary[kExtraDataKey] = {};
	summary[kExtraDataKey][kOriginalMessagesKey] = originalMessages;
	summary[kExtraDataKey][kMessageEstimatedTokenCountKey] = await Promise.all(originalMessages.map(item => stContext.getTokenCountAsync(item.mes)));

	return summary;
}

async function BringIntoView(msgIndex, ilsSettings)
{
	if (!ilsSettings.autoScroll)
		return;

	// Still need sleep since 'chat-scrollto' is not 100% reliable
	await Sleep(100);

	const stContext = SillyTavern.getContext();
	await stContext.executeSlashCommandsWithOptions(`/chat-scrollto ${msgIndex}`);
}

// =========================
// Generation Functions
// =========================

async function SwapToSummaryProfile(stContext, ilsInstance, ilsSettings)
{
	const apiMode = stContext.mainApi?.toLowerCase();
	const presetName = ilsSettings?.apiPresets?.[apiMode] ?? "";

	let useDifferentProfile = ilsSettings.useDifferentProfile && ilsSettings.profileName !== "" && ilsSettings.profileName !== "<None>" && ilsInstance.connProfEnabled;
	let useDifferentApiPreset = ilsSettings.useDifferentApiPreset && presetName !== "" && ilsInstance.connProfEnabled;

	let success = true;

	let prevProfile = "";
	let prevPreset = "";
	if (useDifferentProfile)
	{
		prevProfile = (await stContext.executeSlashCommandsWithOptions("/profile")).pipe;

		const swapResult = await stContext.executeSlashCommandsWithOptions("/profile " + ilsSettings.profileName);
		stContext = SillyTavern.getContext(); // Update context just in case
		if (swapResult.isError)
		{
			ShowError("Failed to swap connection profile to:\n" + ilsSettings.profileName + "\nGeneration Aborted.");
			success = false;
		}
	}

	if (useDifferentApiPreset && success)
	{
		const presetManager = stContext.getPresetManager();
		prevPreset = presetManager.getSelectedPresetName();

		const swapResult = await stContext.executeSlashCommandsWithOptions("/preset " + presetName);
		stContext = SillyTavern.getContext(); // Update context just in case
		if (swapResult.isError)
		{
			ShowError("Failed to swap API Preset " + apiMode + " to:\n" + presetName + "\nGeneration Aborted.");
			success = false;
		}
	}

	return { success, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset };
}

async function SwapBackFromSummaryProfile(stContext, profileSwap, ilsSettings)
{
	if (profileSwap.useDifferentProfile)
	{
		const swapResult = await stContext.executeSlashCommandsWithOptions("/profile " + profileSwap.prevProfile);
		if (swapResult.isError)
		{
			ShowError("Failed to restore connection profile to:\n" + ilsSettings.profileName + "\nPlease check the profile manually.");
		}
	}

	if (profileSwap.useDifferentApiPreset)
	{
		const swapResult = await stContext.executeSlashCommandsWithOptions("/preset " + profileSwap.prevPreset);
		if (swapResult.isError)
		{
			ShowError("Failed to restore preset to:\n" + ilsSettings.profileName + "\nPlease check the preset manually.");
		}
	}
}

async function PopulateSummaryMessage(stContext, summaryMsg, msgText, msgReasoning, ilsSettings)
{
	const ilsInstance = GetILSInstance();
	const runRegex = (ilsInstance.regexEnabled && ilsSettings.regexPostGenerate);

	if (msgText != null)
		summaryMsg.mes = runRegex ? getRegexedString(msgText, regex_placement.AI_OUTPUT, { isPrompt: false, isEdit: true, depth: 0 }) : msgText;

	if (msgReasoning != null)
		summaryMsg.extra.reasoning = runRegex ? getRegexedString(msgReasoning, regex_placement.REASONING, { isPrompt: false, isEdit: true, depth: 0 }) : msgReasoning;

	summaryMsg.send_date = getMessageTimeStamp();
	summaryMsg.extra.api = getGeneratingApi();
	summaryMsg.extra.model = getGeneratingModel();
	summaryMsg.extra.token_count = await stContext.getTokenCountAsync(summaryMsg.mes);
}

async function GenerateSummaryAI(ilsSettings = GetCurrentSettings())
{
	let stContext = SillyTavern.getContext();
	const selection = GetSelection(stContext);
	if (!IsValidRangeSelection(selection))
		return false;

	const ilsInstance = GetILSInstance()
	if (ilsInstance.operationLock)
		return false;

	ilsInstance.operationLock = true;
	stContext.deactivateSendButtons();

	// Swap Profile
	const profileSwap = await SwapToSummaryProfile(stContext, ilsInstance, ilsSettings);

	if (!profileSwap.success)
	{
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return false;
	}

	// Prepare original messages and prompt
	const originalMessages = stContext.chat.slice(selection.start, selection.end + 1);
	const { promptOk, promptMsg, promptError } = await MakeSummaryPrompt(selection.start, stContext.chat.length - (selection.end + 1), originalMessages, stContext, ilsSettings);

	if (!promptOk)
	{
		ShowError("Failed to make summary prompt.\n" + promptError);
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return false;
	}

	// Start LLM generation asynchronously without awaiting yet
	let genStart = await StartGenerate(stContext, promptMsg, ilsSettings.tokenLimit);

	// create empty summary message while generation runs
	const newSummaryMsg = await CreateEmptySummaryMessage(originalMessages, stContext, ilsSettings);

	// Delete Originals
	stContext.chat.splice(selection.start, originalMessages.length);
	// Insert summary message into chat and save/reload
	stContext.chat.splice(selection.start, 0, newSummaryMsg);

	const chatReload1 = await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. Summary generation could not be completed. Refreshing the page is recommended.");
	if (!chatReload1)
	{
		await FinishGenerate(stContext, genStart);
		await SwapBackFromSummaryProfile(stContext, profileSwap, ilsSettings);

		stContext.activateSendButtons();
		ilsInstance.operationLock = false;

		return false;
	}

	await BringIntoView(selection.start, ilsSettings);

	// Find and update the HTML element for the summary message with a loading spinner
	{
		const summaryMsgElement = document.querySelector(`.mes[mesid="${selection.start}"]`);
		if (summaryMsgElement)
		{
			const mesTextElement = summaryMsgElement.querySelector(".mes_text");
			if (mesTextElement)
			{
				// Create and insert loading spinner
				// We don't need to delete the spinner as reloading the chat will destroy it for us.
				const spinner = MakeSpinner();
				mesTextElement.innerHTML = "";
				mesTextElement.appendChild(spinner);
			}
		}
	}

	// Now await for the LLM response to complete
	let genResponse = await FinishGenerate(stContext, genStart);

	await PopulateSummaryMessage(stContext, stContext.chat[selection.start], genResponse.mainMsg, genResponse.reasoning, ilsSettings);

	await stContext.eventSource.emit("ILS_SummaryAdded", { msgIndex: selection.start, originalMessages: originalMessages, isManual: false, isRegenerate: false });

	ClearSelection(stContext, false);

	// Save and reload to reflect the final response in the UI
	const chatReload2 = await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. Summary could not be saved. Refreshing the page is recommended.");

	await SwapBackFromSummaryProfile(stContext, profileSwap, ilsSettings);

	stContext.activateSendButtons();
	ilsInstance.operationLock = false;

	if (chatReload2)
		BringIntoView(selection.start, ilsSettings);

	return genResponse.isOk && chatReload2;
}

async function GenerateSummaryManual()
{
	const stContext = SillyTavern.getContext();
	const ilsSettings = GetCurrentSettings();
	const selection = GetSelection(stContext);
	if (!IsValidRangeSelection(selection))
		return false;

	const ilsInstance = GetILSInstance();
	if (ilsInstance.operationLock)
		return false;

	ilsInstance.operationLock = true;

	// Prepare original messages and prompt
	const originalMessages = stContext.chat.slice(selection.start, selection.end + 1);

	const newSummaryMsg = await CreateEmptySummaryMessage(originalMessages, stContext, ilsSettings);
	newSummaryMsg.mes = "_Manual Summary_\n_Edit and replace this message with a summary_";
	newSummaryMsg.send_date = getMessageTimeStamp();
	newSummaryMsg.extra.api = "custom";
	newSummaryMsg.extra.model = "Inline Summary Extension - Manual Summary";
	newSummaryMsg.extra.token_count = await stContext.getTokenCountAsync(newSummaryMsg.mes);

	// Delete Originals
	stContext.chat.splice(selection.start, originalMessages.length);
	// Add Summary
	stContext.chat.splice(selection.start, 0, newSummaryMsg);

	await stContext.eventSource.emit("ILS_SummaryAdded", { msgIndex: selection.start, originalMessages: originalMessages, isManual: true, isRegenerate: false });

	ClearSelection(stContext, false);

	const chatReload = await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. Summary could not be saved. Refreshing the page is recommended.");

	if (chatReload)
		BringIntoView(selection.start, ilsSettings);
	ilsInstance.operationLock = false;

	return chatReload;
}

async function RegenerateSummary(msgIndex, ilsSettings = GetCurrentSettings())
{
	let stContext = SillyTavern.getContext();

	const summaryMsg = GetMessageByIndex(msgIndex, stContext);
	if (!HasOriginalMessages(summaryMsg))
		return;

	const ilsInstance = GetILSInstance()
	if (ilsInstance.operationLock)
		return;

	ilsInstance.operationLock = true;
	stContext.deactivateSendButtons();

	// Swap Profile
	const profileSwap = await SwapToSummaryProfile(stContext, ilsInstance, ilsSettings);

	if (!profileSwap.success)
	{
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return;
	}

	const originalMessages = summaryMsg[kExtraDataKey][kOriginalMessagesKey];
	const { promptOk, promptMsg, promptError } = await MakeSummaryPrompt(msgIndex, stContext.chat.length - (msgIndex + 1), originalMessages, stContext, ilsSettings);

	if (!promptOk)
	{
		ShowError("Failed to make summary prompt.\n" + promptError);
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return
	}

	// Start LLM generation asynchronously without awaiting yet
	let genStart = await StartGenerate(stContext, promptMsg, ilsSettings.tokenLimit);

	summaryMsg[kExtraDataKey][kMessageEstimatedTokenCountKey] = await Promise.all(originalMessages.map(item => stContext.getTokenCountAsync(item.mes)));

	const summaryMsgElement = document.querySelector(`.mes[mesid="${msgIndex}"]`);
	if (summaryMsgElement)
	{
		// Clear reasoning element to make it neater.
		const reasoningElement = summaryMsgElement.querySelector(".mes_reasoning_details");
		if (reasoningElement)
			reasoningElement.remove();

		const mesTextElement = summaryMsgElement.querySelector(".mes_text");
		if (mesTextElement)
		{
			// Create and insert loading spinner
			// We don't need to delete the spinner as reloading the chat will destroy it for us.
			const spinner = MakeSpinner();
			mesTextElement.innerHTML = "";
			mesTextElement.appendChild(spinner);
		}
	}

	// Now await for the LLM response to complete
	let genResponse = await FinishGenerate(stContext, genStart);

	await PopulateSummaryMessage(stContext, summaryMsg, genResponse.mainMsg, genResponse.reasoning, ilsSettings);

	await stContext.eventSource.emit("ILS_SummaryAdded", { msgIndex: msgIndex, originalMessages: originalMessages, isManual: false, isRegenerate: true });

	// Save and reload to reflect the final response in the UI
	await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. New Summary could not be saved. Refreshing the page is recommended.");

	await SwapBackFromSummaryProfile(stContext, profileSwap, ilsSettings);

	stContext.activateSendButtons();
	ilsInstance.operationLock = false;

	BringIntoView(msgIndex, ilsSettings);
}

// =========================
// Message Action Buttons
// =========================
const kMsgActionButtons = [
	// Select Message Range End
	{
		className: "ils_msg_btn_selectEnd",
		icon: "fa-arrow-right-to-bracket",
		title: "Select Summary End",

		async OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			selection.end = msgIndex;
			RefreshAllMessageButtons();

			await stContext.eventSource.emit("ILS_EndMsgSelected", { msgIndex });
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			if (selection.end === null)
				return kMsgBtnColours.default;
			if (msgIndex === selection.end)
				return kMsgBtnColours.selected;
			if (IsMsgInRange(msgIndex, selection))
				return kMsgBtnColours.between;
			return kMsgBtnColours.default;
		}
	},
	// Select Message Range Start
	{
		className: "ils_msg_btn_selectStart",
		icon: "fa-arrow-right-from-bracket",
		title: "Select Summary Start",

		async OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			selection.start = msgIndex;
			RefreshAllMessageButtons();

			await stContext.eventSource.emit("ILS_StartMsgSelected", { msgIndex });
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			if (selection.start === null)
				return kMsgBtnColours.default;
			if (msgIndex === selection.start)
				return kMsgBtnColours.selected;
			if (IsMsgInRange(msgIndex, selection))
				return kMsgBtnColours.between;
			return kMsgBtnColours.default;
		}
	},
	// Clear Selection
	{
		className: "ils_msg_btn_clearSel",
		icon: "fa-broom",
		title: "Clear Selection",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection) || selection.start === msgIndex || selection.end === msgIndex;
		},

		async OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			ClearSelection(stContext);

			await stContext.eventSource.emit("ILS_SelectionCleared", {});
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const canClear = selection.start !== null || selection.end !== null;
			return canClear ? kMsgBtnColours.clearable : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - LLM
	{
		className: "ils_msg_btn_summarise",
		icon: "fa-robot",
		title: "Summarise (AI)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryAI();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end >= selection.start;
			return valid ? kMsgBtnColours.selected : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - Alternative 1
	{
		className: "ils_msg_btn_summarise_alt1",
		icon: "fa-robot",
		title: "Summarise (AI, Alternative 1)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsAlternativeSettingsUsed(1) && IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryAI(GetCurrentSettings(1));
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end >= selection.start;
			return valid ? kMsgBtnColours.alt1 : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - Alternative 2
	{
		className: "ils_msg_btn_summarise_alt2",
		icon: "fa-robot",
		title: "Summarise (AI, Alternative 2)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsAlternativeSettingsUsed(2) && IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryAI(GetCurrentSettings(2));
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end >= selection.start;
			return valid ? kMsgBtnColours.alt2 : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - Manual
	{
		className: "ils_msg_btn_summarise_manual",
		icon: "fa-user-tag",
		title: "Summarise (Manual)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryManual();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end >= selection.start;
			return valid ? kMsgBtnColours.selected : kMsgBtnColours.default;
		}
	},
];

// =========================
// Header Buttons
// =========================
const kHeaderButtons = [
	// Restore Original Messages
	{
		className: "ils_hrd_btn_restore",
		icon: "fa-file-arrow-up",
		title: "Restore Original and Delete Summary",

		async OnClick(msgIndex)
		{
			const ilsInstance = GetILSInstance()
			if (ilsInstance.operationLock)
				return;

			const stContext = SillyTavern.getContext();
			const ilsSettings = GetCurrentSettings();

			ilsInstance.operationLock = true;
			stContext.deactivateSendButtons();

			await stContext.eventSource.emit("ILS_RestoreOriginalsBegin", { msgIndex });

			const summaryMsg = GetMessageByIndex(msgIndex, stContext);

			// Technically this being false should be an error, since we shouldn't be able to click restore
			// on a message that doesn't have Original Messages.
			if (HasOriginalMessages(summaryMsg))
			{
				// TODO: move this into a separate function
				let originals = summaryMsg[kExtraDataKey][kOriginalMessagesKey];

				stContext.chat.splice(msgIndex + 1, 0, ...originals);
				stContext.chat.splice(msgIndex, 1);
			}

			ClearSelection(stContext, false);

			await stContext.eventSource.emit("ILS_RestoreOriginalsEnd", { msgIndex });

			await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. Original Messages could not be restored. Refreshing the page is recommended.");

			stContext.activateSendButtons();
			ilsInstance.operationLock = false;

			BringIntoView(msgIndex, ilsSettings);
		}
	},
	// Regenerate
	{
		className: "ils_hdr_btn_regenerate",
		icon: "fa-robot",
		title: "Re-Summarise (AI)",

		async OnClick(msgIndex)
		{
			await RegenerateSummary(msgIndex);
		}
	},
	// Regenerate Summary - Alternative 1
	{
		className: "ils_hdr_btn_regenerate_alt1",
		icon: "fa-robot",
		title: "Re-Summarise (AI, Alt 1)",

		ShowCondition()
		{
			return IsAlternativeSettingsUsed(1);
		},

		async OnClick(msgIndex)
		{
			await RegenerateSummary(msgIndex, GetCurrentSettings(1));
		}
	},
	// Regenerate Summary - Alternative 2
	{
		className: "ils_hdr_btn_regenerate_alt2",
		icon: "fa-robot",
		title: "Re-Summarise (AI, Alt 2)",

		ShowCondition()
		{
			return IsAlternativeSettingsUsed(2);
		},

		async OnClick(msgIndex)
		{
			await RegenerateSummary(msgIndex, GetCurrentSettings(2));
		}
	},
];

// =========================
// Message Action Button Rendering
// =========================
function RefreshAllMessageButtons()
{
	document.querySelectorAll(".mes").forEach(node =>
	{
		const msgId = Number(node.getAttribute("mesid"));
		if (!isNaN(msgId))
			RefreshMessageElements(node, msgId);
	});
}

function RefreshMessageElements(messageDiv, msgIndex)
{
	const stContext = SillyTavern.getContext();

	const msgObject = GetMessageByIndex(msgIndex, stContext);
	if (!msgObject)
		return;

	kMsgActionButtons.forEach(def =>
	{
		const msgButton = messageDiv.querySelector("." + def.className);
		if (msgButton)
		{
			msgButton.style.display = (def.ShowCondition && !def.ShowCondition(msgIndex)) ? "none" : null;
			msgButton.style.color = def.GetColor ? def.GetColor(msgIndex) : kMsgBtnColours.default;
		}
	});

	messageDiv.querySelectorAll(".ils_msg_container_header .mes_button").forEach(button =>
	{
		const headerButton = kHeaderButtons.find(def => button.classList.contains(def.className));
		if (headerButton?.ShowCondition)
			button.style.display = headerButton.ShowCondition(msgIndex) ? null : "none";
	});

	const existingOrigMsgDiv = messageDiv.querySelector(".ils_original_messages_root");
	if (HasOriginalMessages(msgObject))
	{
		if (existingOrigMsgDiv)
		{
			// This is a strange one, for some reason we can end up with a div with a wrong `mesid`
			// And just deleting the existing one seems fine too as the refresh is actually called twice
			// I'm guessing one call might be manual, the other caused by the observer?

			// In any case, I think chat refresh may not destroy all ofthe chat message html elements
			// so some retain the original message blocks

			// We do a few sanity checks and delete the blocks if they're invalid

			// Ensure the correct ID
			if (existingOrigMsgDiv.getAttribute("mesid") != msgIndex)
			{
				existingOrigMsgDiv.remove();
				return;
			}

			// Ensure correct message count
			const containerElement = messageDiv.querySelector(".ils_messages_container_root");
			if (containerElement)
			{
				if (containerElement.getAttribute("msgCount") != msgObject[kExtraDataKey][kOriginalMessagesKey].length)
				{
					existingOrigMsgDiv.remove();
					return;
				}
			}
		}
		else
		{
			const newOrigMsgDiv = document.createElement("div");
			newOrigMsgDiv.className = "ils_original_messages_root";
			newOrigMsgDiv.setAttribute("mesid", msgIndex);

			newOrigMsgDiv.appendChild(CreateOriginalMessagesContainer(msgIndex, msgObject));

			messageDiv.querySelector(".mes_block")?.appendChild(newOrigMsgDiv);
		}

		// Remove swipe button on Summaries as swiping on a summary would likely break stuff
		/* Revert for now, apparently causes issues on mobile?
		const swipeButton = messageDiv.querySelector(".swipeRightBlock");
		if (swipeButton)
			swipeButton.remove();
		*/
	}
	else if (existingOrigMsgDiv)
	{
		existingOrigMsgDiv.remove();
	}
}

// =========================
// Original Message Display Handling
// =========================
function GetMessageFromPath(path, stContext)
{
	if (!Array.isArray(path) || path.length === 0)
		return null;

	const [msgIndex, ...subpath] = path;

	let msg = GetMessageByIndex(msgIndex, stContext);
	if (!msg || !HasOriginalMessages(msg))
		return null;

	for (const index of subpath)
	{
		if (!HasOriginalMessages(msg))
			return null;

		msg = msg[kExtraDataKey][kOriginalMessagesKey][index];
		if (!msg)
			return null;
	}

	return msg;
}

function CreateOriginalMessagesContainer(msgIndex, msgObject, depth = 0, path = [])
{
	const originals = (msgObject[kExtraDataKey] && Array.isArray(msgObject[kExtraDataKey][kOriginalMessagesKey]))
		? msgObject[kExtraDataKey][kOriginalMessagesKey]
		: [];

	const containerRoot = document.createElement("div");
	containerRoot.setAttribute("msgCount", originals.length);
	containerRoot.className = "ils_messages_container_root";
	containerRoot.style.borderLeft = `2px solid ${GetDepthColour(depth)}`;
	containerRoot.style.paddingLeft = "2px";

	// Header (flex with label on left and expand icon on right)
	const containerHeader = document.createElement("div");
	containerHeader.className = "ils_msg_container_header";
	containerHeader.setAttribute("ils-msg-depth", depth);
	containerHeader.setAttribute("ils-msg-index", msgIndex);
	containerHeader.setAttribute("ils-msg-path", JSON.stringify([...path, msgIndex]));
	containerHeader.style.background = `linear-gradient(90deg, ${GetDepthColourWithAlpha(depth, 0.3)}, transparent)`;
	containerHeader.style.border = `1px solid ${GetDepthColourWithAlpha(depth, 0.18)}`;

	const buttonsDiv = document.createElement("div");
	if (depth === 0)
	{
		kHeaderButtons.forEach(def =>
		{
			const btn = document.createElement("div");
			btn.className = `mes_button fa-solid ${def.icon} interactable ${def.className}`;
			btn.setAttribute("mesid", msgIndex);
			btn.title = def.title;
			btn.tabIndex = 0;
			if (def.ShowCondition && !def.ShowCondition(msgIndex))
				btn.style.display = "none";

			buttonsDiv.appendChild(btn);
		});
	}
	containerHeader.appendChild(buttonsDiv);

	const headerLabel = document.createElement("div");
	let origTokens = 0;
	let visMsg = 0;
	for (let i = 0; i < originals.length; ++i)
	{
		const msg = originals[i];

		if (msg?.is_system)
			continue;

		visMsg++;

		const cachedTokenCount = msgObject?.extra?.[kExtraDataKey]?.[kMessageEstimatedTokenCountKey]?.[i];
		// token_count does include reasoning, which we do not summarise, so only use it on chats where we do our own maths.
		origTokens += Number((cachedTokenCount == null) ? (msg?.extra?.token_count ?? 0) : cachedTokenCount) || 0;
	}
	headerLabel.textContent = `Original Messages: ${visMsg}/${originals.length} used | ~${origTokens} tokens`;

	const expandIcon = document.createElement("div");
	expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-right";

	containerHeader.appendChild(headerLabel);
	containerHeader.appendChild(expandIcon);

	// Contents - Empty by default, filled in when expanding
	const containerContents = document.createElement("div");
	containerContents.className = "ils_msg_container_contents";
	containerContents.setAttribute("ils-msg-depth", depth);

	// Add to root
	containerRoot.appendChild(containerHeader);
	containerRoot.appendChild(containerContents);

	return containerRoot;
}
function OrigMsgHeaderSeparator(depth)
{
	const sep = document.createElement("div");
	sep.className = "ils_separator";
	sep.style.background = `${GetDepthColourWithAlpha(depth, 0.22)}`;
	return sep;
}

function CreateOriginalMessageBody(msgIndex, msgObject, stContext, depth = 0, path = [])
{
	// Main Element
	const messageRoot = document.createElement("div");
	messageRoot.className = "ils_original_message";
	messageRoot.style.border = `1px solid ${GetDepthColourWithAlpha(depth, 0.22)}`;

	// Header
	const headerRow = document.createElement("div");
	headerRow.className = "ils_original_message_header flex-container";
	messageRoot.appendChild(headerRow);

	// Avatar Image
	if (!power_user.hideChatAvatars_enabled)
	{
		const avatarImg = document.createElement("img");
		avatarImg.className = "ils_avi_img";
		if (!msgObject.is_user)
		{
			if (msgObject.force_avatar)
				avatarImg.src = msgObject.force_avatar;
			else if (this_chid === undefined)
				avatarImg.src = system_avatar;
			else if (stContext.characters[this_chid] && stContext.characters[this_chid].avatar !== 'none')
				avatarImg.src = stContext.getThumbnailUrl('avatar', stContext.characters[this_chid].avatar);
			else
				avatarImg.src = default_avatar;
		}
		else if (msgObject.is_user && msgObject.force_avatar)
		{
			avatarImg.src = msgObject.force_avatar;
		}
		headerRow.appendChild(avatarImg);

		headerRow.appendChild(OrigMsgHeaderSeparator(depth));
	}

	// Message Index
	const msgIndexElem = document.createElement("div");
	msgIndexElem.className = "mesIDDisplay";
	msgIndexElem.textContent = `#${msgIndex}`;
	headerRow.appendChild(msgIndexElem);

	headerRow.appendChild(OrigMsgHeaderSeparator(depth));

	// Characetr Name
	const nameSpan = document.createElement("span");
	nameSpan.className = "name_text";
	nameSpan.textContent = msgObject.name || "Unknown";
	headerRow.appendChild(nameSpan);

	headerRow.appendChild(OrigMsgHeaderSeparator(depth));

	// Token Counter
	if (power_user.message_token_count_enabled)
	{
		const tokenDisp = document.createElement("div");
		tokenDisp.className = "tokenCounterDisplay";
		tokenDisp.textContent = (msgObject.extra.token_count ?? "--") + "t";
		headerRow.appendChild(tokenDisp);

		headerRow.appendChild(OrigMsgHeaderSeparator(depth));
	}

	// Timestamp
	if (power_user.timestamps_enabled)
	{
		const timestamp = document.createElement("div");
		timestamp.className = "timestamp";
		const momentDate = timestampToMoment(msgObject.send_date);
		timestamp.textContent = momentDate.isValid() ? momentDate.format('LL LT') : '';
		headerRow.appendChild(timestamp);

		headerRow.appendChild(OrigMsgHeaderSeparator(depth));
	}

	// Messae Contents
	const contentDiv = document.createElement("div");
	contentDiv.className = "ils_mes_text";
	messageRoot.appendChild(contentDiv);

	// Check if there are images
	if (Array.isArray(msgObject.extra?.media) && msgObject.extra.media.length > 0)
	{
		const mediaArray = msgObject.extra.media;
		const requestedIndex = Number.isInteger(msgObject.extra.media_index) ? msgObject.extra.media_index : 0;
		const safeIndex = (requestedIndex >= 0 && requestedIndex < mediaArray.length) ? requestedIndex : 0;

		const mediaItem = mediaArray[safeIndex];
		if (mediaItem?.url)
		{
			const imgElem = document.createElement("img");
			imgElem.className = "ils_mes_img";
			imgElem.src = mediaItem.url;
			contentDiv.appendChild(imgElem);
		}
	}
	else
	{
		contentDiv.innerHTML = stContext.messageFormatting(msgObject.mes || "(empty message)", msgObject.name || "Unknown", msgObject.is_system, msgObject.is_user, 0);
	}

	// Add any child messages
	if (HasOriginalMessages(msgObject))
	{
		messageRoot.appendChild(CreateOriginalMessagesContainer(msgIndex, msgObject, depth + 1, path));
	}

	return messageRoot;
}

function HandleMessagesHeaderClick(containerHeaderDiv)
{
	const stContext = SillyTavern.getContext();

	const msgDepth = Number(containerHeaderDiv.getAttribute("ils-msg-depth"));
	const msgIndex = Number(containerHeaderDiv.getAttribute("ils-msg-index"));
	const pathStr = containerHeaderDiv.getAttribute("ils-msg-path");

	if (isNaN(msgDepth) || isNaN(msgIndex))
		return;

	const containerContents = containerHeaderDiv.parentElement.querySelector(".ils_msg_container_contents");
	if (!containerContents)
		return;

	const expandIcon = containerHeaderDiv.querySelector('.ils_expand_icon');

	if (containerContents.childNodes.length === 0)
	{
		let path;
		try
		{
			path = JSON.parse(pathStr);
		}
		catch (e)
		{
			console.error("[ILS] Failed to parse message path:", e);
			return;
		}

		const msgObject = GetMessageFromPath(path, stContext);
		if (!msgObject)
			return;

		const messages = (msgObject[kExtraDataKey] && Array.isArray(msgObject[kExtraDataKey][kOriginalMessagesKey]))
			? msgObject[kExtraDataKey][kOriginalMessagesKey]
			: [];

		messages.forEach((orgiMsg, origIndex) =>
		{
			const origMsgBody = CreateOriginalMessageBody(origIndex, orgiMsg, stContext, msgDepth + 1, path);
			if (origMsgBody)
				containerContents.appendChild(origMsgBody);
		});

		if (expandIcon)
			expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-down";
	}
	else
	{
		containerContents.innerHTML = "";
		if (expandIcon)
			expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-right";
	}
}

// =========================
// Event Handlers
// =========================
function MainClickHandler(e)
{
	// Header Buttons
	for (const def of kHeaderButtons)
	{
		const btn = e.target.closest("." + def.className);
		if (btn)
		{
			const msgIndex = Number(btn.getAttribute("mesid"));
			if (!isNaN(msgIndex))
			{
				def.OnClick(msgIndex);
				return;
			}
		}
	}

	// Header Click
	const containerHeaderDiv = e.target.closest(".ils_msg_container_header");
	if (containerHeaderDiv)
	{
		HandleMessagesHeaderClick(containerHeaderDiv);
		return;
	}

	// Message Action Buttons
	const btn = e.target.closest(".mes_button");
	if (!btn)
		return;

	const messageDiv = e.target.closest(".mes");
	if (!messageDiv)
		return;

	const messageId = Number(messageDiv.getAttribute("mesid"));
	if (isNaN(messageId))
		return;

	for (const def of kMsgActionButtons)
	{
		if (btn.classList.contains(def.className))
		{
			def.OnClick(messageId);
			break;
		}
	}
}

async function OnChatChanged(data)
{
	const stContext = SillyTavern.getContext();
	const ilsSettings = GetCurrentSettings();

	ClearSelection(stContext);

	// Legacy Recovery
	if (ilsSettings.doLegacyRecovery)
	{
		let didRecover = false;
		for (const msg of stContext.chat)
		{
			if (RecoverOldData(msg))
				didRecover = true;
		}

		if (didRecover)
		{
			ShowWarning("Legacy chat summaries have been recovered.");
			await SaveAndReloadChat(stContext, "Failed to Save and Reload chat while recovering legacy summaries... Well, that's less than ideal.");
		}
	}
}

function OnMoreMsgLoaded(data)
{
	RefreshAllMessageButtons();
}

function OnMainApiChanged(data)
{
	UpdateSettingsUI();
}

async function OnMessageEdited(data)
{
	const msgIdx = Number(data);

	const stContext = SillyTavern.getContext();
	const msg = GetMessageByIndex(msgIdx, stContext);

	if (HasOriginalMessages(msg))
		msg.extra.token_count = await stContext.getTokenCountAsync(msg.mes);
}

// =========================
// Slash Command Handling
// =========================
async function SummariseCommand(namedArgs, unnamedArgs)
{
	const stContext = SillyTavern.getContext();
	const selection = GetSelection(stContext);

	const idParams = String(unnamedArgs).split(' ');

	selection.start = idParams[0] ? Math.max(0, parseInt(idParams[0], 10)) : null;
	selection.end = idParams[1] ? Math.min(parseInt(idParams[1], 10), stContext.chat.length - 1) : null;

	if (!IsValidRangeSelection(selection))
	{
		toastr.error("[ILS] Invalid message range: " + String(selection.start) + " - " + String(selection.end));
		ClearSelection(stContext);
		return "";
	}

	const manualMode = String(namedArgs.manual).trim().toLowerCase() == "true";
	if (manualMode)
		await GenerateSummaryManual();
	else
		await GenerateSummaryAI();
	return "";
}

async function RestoreCommand(namedArgs, unnamedArgs)
{
	const idParams = String(unnamedArgs).split(' ');
	let numToRestore = idParams[0] ? Math.max(0, parseInt(idParams[0], 10)) : 0;

	const ilsInstance = GetILSInstance();
	if (ilsInstance.operationLock)
		return "";

	const stContext = SillyTavern.getContext();

	ilsInstance.operationLock = true;
	stContext.deactivateSendButtons();

	let didRestore = false;
	while (numToRestore > 0)
	{
		let lastSummary = -1;
		for (let i = stContext.chat.length - 1; i >= 0; --i)
		{
			if (HasOriginalMessages(stContext.chat[i]))
			{
				lastSummary = i;
				break;
			}
		}
		if (lastSummary > -1)
		{
			// TODO: move this into a separate function
			let originals = stContext.chat[lastSummary][kExtraDataKey][kOriginalMessagesKey];

			stContext.chat.splice(lastSummary + 1, 0, ...originals);
			stContext.chat.splice(lastSummary, 1);
			didRestore = true;
		}
		else
		{
			break;
		}

		--numToRestore;
	}

	ClearSelection(stContext, !didRestore);
	if (didRestore)
	{
		await SaveAndReloadChat(stContext, "Failed to Save and Reload chat. Failed to Restore messages. Refreshing the page is recommended.");
	}

	stContext.activateSendButtons();
	ilsInstance.operationLock = false;

	return "";
}

async function Experiment1(namedArgs, unnamedArgs)
{
	const idParams = String(unnamedArgs).split(' ');
	const chunkSize = idParams[0] ? Math.max(2, parseInt(idParams[0], 10)) : 2;

	const manualMode = String(namedArgs.manual).trim().toLowerCase() == "true";

	while (true)
	{
		const stContext = SillyTavern.getContext();
		const selection = GetSelection(stContext);

		let lastSummary = -1;
		for (let i = stContext.chat.length - 1; i >= 0; --i)
		{
			if (HasOriginalMessages(stContext.chat[i]))
			{
				lastSummary = i;
				break;
			}
		}

		// Count summarisable messages, skipping over hidden messages
		let summaryFrom = lastSummary + 1;
		let summaryTo = summaryFrom;
		let messageCount = 0;
		for (let i = summaryFrom; (i < stContext.chat.length) && (messageCount < chunkSize); ++i)
		{
			if (!stContext.chat[i].is_system)
				++messageCount;

			summaryTo = i;
		}

		// Not Enough Messages
		if (messageCount < chunkSize)
			break;

		// Count reamining messages, skipping over hidden messages
		let remainingMessages = 0;
		for (let i = summaryTo + 1; i < stContext.chat.length; ++i)
		{
			if (!stContext.chat[i].is_system)
				++remainingMessages;
		}

		// Not Enough Messages
		if (remainingMessages < chunkSize)
			break;

		selection.start = summaryFrom;
		selection.end = summaryTo;

		let isOk = true;
		if (manualMode)
			isOk = await GenerateSummaryManual();
		else
			isOk = await GenerateSummaryAI();

		if (!isOk)
			break;
	}

	return "";
}

async function Experiment2(namedArgs, unnamedArgs)
{
	const idParams = String(unnamedArgs).split(' ');
	const chunkSize = idParams[0] ? Math.max(2, parseInt(idParams[0], 10)) : 2;

	const manualMode = String(namedArgs.manual).trim().toLowerCase() == "true";

	while (true)
	{
		const stContext = SillyTavern.getContext();
		const selection = GetSelection(stContext);

		// Count summarisable messages, skipping over hidden messages
		let summaryFrom = 0;
		let summaryTo = summaryFrom;
		let messageCount = 0;
		for (let i = summaryFrom; (i < stContext.chat.length) && (messageCount < chunkSize); ++i)
		{
			if (!stContext.chat[i].is_system)
				++messageCount;

			summaryTo = i;
		}

		// Not Enough Messages
		if (messageCount < chunkSize)
			break;

		// Count reamining messages, skipping over hidden messages
		let remainingMessages = 0;
		for (let i = summaryTo + 1; i < stContext.chat.length; ++i)
		{
			if (!stContext.chat[i].is_system)
				++remainingMessages;
		}

		// Not Enough Messages
		if (remainingMessages < chunkSize)
			break;

		selection.start = summaryFrom;
		selection.end = summaryTo;

		let isOk = true;
		if (manualMode)
			isOk = await GenerateSummaryManual();
		else
			isOk = await GenerateSummaryAI();

		if (!isOk)
			break;
	}

	return "";
}

// =========================
// Initialise
// =========================
jQuery(async () =>
{
	const stContext = SillyTavern.getContext();
	const ilsInstance = GetILSInstance();

	await LoadSettings(stContext);
	await LoadSettings(stContext, 1);
	await LoadSettings(stContext, 2);

	// Setup Settings Menu
	const settingsHtml = await $.get(kSettingsFile);

	const $extensions = $("#extensions_settings");
	const $existing = $extensions.find(".inline-summary-settings");
	if ($existing.length > 0)
		$existing.replaceWith(settingsHtml);
	else
		$extensions.append(settingsHtml);

	// Fill In setting values
	await UpdateSettingsUI();

	SetupOnSettingChangeEvents();

	// Message Action Buttons
	const templateContainer = document.querySelector("#message_template .mes_buttons .extraMesButtons");
	if (templateContainer)
	{
		// Prepend buttons, this will result in reverse ordering, but it will be to the left of the button list.
		kMsgActionButtons.forEach(def =>
		{
			if (templateContainer.querySelector("." + def.className))
				return;

			const btn = document.createElement("div");
			btn.className = `mes_button fa-solid ${def.icon} interactable ${def.className}`;
			btn.title = def.title;
			btn.tabIndex = 0;
			btn.style.color = kMsgBtnColours.default;

			templateContainer.prepend(btn);
		});
	}
	else
	{
		console.error("[ILS] Could not find message template to inject buttons");
	}

	// Chat Observer
	const chatContainer = document.getElementById("chat");
	if (chatContainer)
	{
		if (ilsInstance.chatObs)
			ilsInstance.chatObs.disconnect();

		ilsInstance.chatObs = new MutationObserver(mutations =>
		{
			for (const m of mutations)
			{
				for (const node of m.addedNodes)
				{
					if (node.classList?.contains("mes"))
					{
						const msgId = Number(node.getAttribute("mesid"));
						if (!isNaN(msgId))
							RefreshMessageElements(node, msgId);
					}
				}
			}
		});

		ilsInstance.chatObs.observe(chatContainer, { childList: true, subtree: true });
	}
	else
	{
		console.error("[ILS] Failed to setup Observer.")
	}

	// Other Events
	const kEventsToRegister = [
		{ type: stContext.eventTypes.CHAT_CHANGED, handler: OnChatChanged },
		{ type: stContext.eventTypes.MORE_MESSAGES_LOADED, handler: OnMoreMsgLoaded },
		{ type: stContext.eventTypes.MAIN_API_CHANGED, handler: OnMainApiChanged },
		{ type: stContext.eventTypes.MESSAGE_EDITED, handler: OnMessageEdited },
	];

	for (const { type, handler } of kEventsToRegister)
	{
		const flagName = `evt_${type}_registered`;
		if (!ilsInstance[flagName])
		{
			stContext.eventSource.on(type, handler);
			ilsInstance[flagName] = true;
		}
	}

	document.removeEventListener("click", MainClickHandler);
	document.addEventListener("click", MainClickHandler);
	document.removeEventListener("ils-settings-changed", RefreshAllMessageButtons);
	document.addEventListener("ils-settings-changed", RefreshAllMessageButtons);

	stContext.SlashCommandParser.addCommandObject(stContext.SlashCommand.fromProps({
		name: "ils-summarise",
		callback: SummariseCommand,
		namedArgumentList: [
			stContext.SlashCommandNamedArgument.fromProps({
				name: 'manual',
				description: 'Insert manual summary message instead of using AI.',
				typeList: stContext.ARGUMENT_TYPE.BOOLEAN,
				defaultValue: 'false',
			}),
		],
		unnamedArgumentList: [
			stContext.SlashCommandArgument.fromProps({
				description: 'First message index',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
			stContext.SlashCommandArgument.fromProps({
				description: 'Last message index',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
		],
		helpString: `
		<div>
			Summarise the specified range of messages using AI. Inclusive range, must contain at least 1 message.
		</div>
		<div>
			<strong>Examples:</strong>
			<pre><code class="language-stscript">/ils-summarise 8 16</code></pre>
			<pre><code class="language-stscript">/ils-summarise manual=true 10 20</code></pre>
		</div>
		`
	}));

	stContext.SlashCommandParser.addCommandObject(stContext.SlashCommand.fromProps({
		name: "ils-restore",
		callback: RestoreCommand,
		unnamedArgumentList: [
			stContext.SlashCommandArgument.fromProps({
				description: 'Summaries to restore',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
		],
		helpString: `
		<div>
			Restore original messages from specified number of latest summaries.
		</div>
		<div>
			<strong>Examples:</strong>
			<pre><code class="language-stscript">/ils-restore 3</code></pre>
		</div>
		`
	}));

	stContext.SlashCommandParser.addCommandObject(stContext.SlashCommand.fromProps({
		name: "ils-experimental-summarise-linear",
		callback: Experiment1,
		namedArgumentList: [
			stContext.SlashCommandNamedArgument.fromProps({
				name: 'manual',
				description: 'Insert manual summary message instead of using AI.',
				typeList: stContext.ARGUMENT_TYPE.BOOLEAN,
				defaultValue: 'false',
			}),
		],
		unnamedArgumentList: [
			stContext.SlashCommandArgument.fromProps({
				description: 'Param',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
		],
		helpString: `
		<div>
			Experimental 1 - Summarise All Linear - Use at your own risk!
		</div>
		<div>
			<strong>Examples:</strong>
			<pre><code class="language-stscript">/ils-experimental-summarise-linear 10</code></pre>
			<pre><code class="language-stscript">/ils-experimental-summarise-linear manual=true 10</code></pre>
		</div>
		`
	}));

	stContext.SlashCommandParser.addCommandObject(stContext.SlashCommand.fromProps({
		name: "ils-experimental-summarise-stacked",
		callback: Experiment2,
		namedArgumentList: [
			stContext.SlashCommandNamedArgument.fromProps({
				name: 'manual',
				description: 'Insert manual summary message instead of using AI.',
				typeList: stContext.ARGUMENT_TYPE.BOOLEAN,
				defaultValue: 'false',
			}),
		],
		unnamedArgumentList: [
			stContext.SlashCommandArgument.fromProps({
				description: 'Param',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
		],
		helpString: `
		<div>
			Experimental 2 - Summarise All Stacked - Use at your own risk!
		</div>
		<div>
			<strong>Examples:</strong>
			<pre><code class="language-stscript">/ils-experimental-summarise-stacked 10</code></pre>
			<pre><code class="language-stscript">/ils-experimental-summarise-stacked manual=true 10</code></pre>
		</div>
		`
	}));

	console.log("[ILS] Inline Summary - Ready");
});
