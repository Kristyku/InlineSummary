# Full Changelog

#### v1.2.3
Added two optional alternative preset slots. Each configured slot adds its own AI Summary and Re-Summarise buttons, allowing summaries to be generated with different extension settings without changing the main preset.<br>
AI and manual summaries can now be created from a single selected message by selecting the same message as both the start and end.<br>

#### v1.2.2
Added event hooks for selection, summary creation, and restore actions so other extensions can respond to the summary workflow.

#### v1.2.1
Added an option to use multiple messages as the summary prompt. This should make the prompt respect the "Character Names Behavior" setting.

#### v1.2.0
Fixed original message data being duplicated in the saved chat files leading to file size bloat. A recovery step will run when loading old chats to remove duplicates and move data where it won't get duplicated (can be disabled in options).<br>
Added some error checking to improve rare but critical scenarios where SillyTavern might fail saving chat.

#### v1.1.9
Streaming support for Text Completion API. It uses the setting from the preset and will allow larger reply sizes for certain LLM providers.

#### v1.1.8
Fixed missing fucntion import causing an exception.<br>
Change summary role from System to User to stop strict modes inserting extra message.

#### v1.1.7
Fixed v1.1.6 changes not workin with strict/semi-strict modes

#### v1.1.6
Streaming support for OpenAI API. It uses the setting from the preset and will allow larger reply sizes for certain LLM providers.

#### v1.1.5
Added Regex support to summary generation process.

#### v1.1.4
Fixed Historical Context not being counted properly toward total prompt size.<br>
Improved error messages when summary context size is exceeded.

#### v1.1.3
Adjusted css style for original messages.

#### v1.1.2
Summary Messages can now have Reasoning block if the model produced it (Requires a SillyTavern update).<br>
Summary Messages now show the model, date and token count.<br>
Summary Messages now recalculate message token count when manually edited.<br>
Better error messages if Summary generation fails (Requires a SillyTavern update).

#### v1.1.1
Fixed end prompt not being saved.<br>
The token counter for Original Messages is now more accurate (applies to new summaries or regenerated only).

#### v1.1.0
All API modes should now be supported for custom presets.<br>
Ability to have multiple setting presets and import/export them has been added (Note, some saved settings have been reset to defaults).<br>
Original Messages now preview images that have been included in the summary range.<br>
Original Messages section header now has info about how many messages were used in the summary (not marked as hidden) and total token estimate (only real messages count, summaries inside orgiignal messages will count as 0)

#### v1.0.13
Fixed Re-Summarise not respecting token limit setting.

#### v1.0.12
Fixed messages marked as hidden included in summary prompts.

#### v1.0.11
Fixed `Original Messages` not appearing on chat messages when after they were hidden by the visible message limit.<br>
Added `/ils-summarise` command. Usage: `/ils-summarise x y` or `/ils-summarise manual=[true|false] x y` where x and y are start and stop message indices; `manual` mode inserts an placeholder summary message instead of using an AI.<br>
Changed error messages to use toast popups.

#### v1.0.10
Changed Original Messages CSS style to be a copy, instead of reusing 'mes_text', this fixes editing summary when original messages are in the expanded state.

#### v1.0.9
Fixed summary regeneration not using connection profile/preset.<br>
Added summary prompt size checks and autmated historical context trimming if it exceeds allowed context size.

#### v1.0.8
Connection Profiles and Chat Completion Presets will now be disabled if `Connection Profiles` extension is disabled.

#### v1.0.7
Fixed the prompt length check using Text Completion context size value at all times.

#### v1.0.6
Hotfix to fetch latest context more often, ~should fix prompt not fitting into the context error.~ Fixed in v1.0.7
Hotfix to adjust scrolling behaviour, will now scroll to summary message more reliably after chat refresh (Still not 100% though)

#### v1.0.5
Added option to disable auto-scroll.<br>
Added option to change the summary message user name (User/Character/Custom).<br>
Added a basic check to see if a summary prompt exceeds max context size. Also added a more detailed error mesasge if API call fails with less than 10% free context remaining.

#### v1.0.4
Fixed an issue where Restore and Re-generate buttons would get a wrong message ID resulting in showing wrong original messages and trying to re-generate summary using wrong messages.<br>
Added a spinner and error checking for summary re-generation.<br>
Added some guards to prevent buttons being clicked again from triggering a generation action while one is already running.<br>
Increased `loading_order` value in the manifest. This extension doesn't really care about it, but this might be better for compatibility with other extensions.

#### v1.0.3
Chat will now attempt to scroll after reload to the summary message or the restored messages. (Note, can sometimes be unreliable as reloading chat triggers a scroll to the bottom and I'm tryingto scroll up, but should be better than nothing)<br>
Added some protections against double-registering event handlers during hot reloads based on ArtemDMI fork.

#### v1.0.2
Added end prompt option, which is inserted after the content to summarise. (For models that have options like `/nothink`)<br>
Added option to specify a connection profile.<br>
Added option to specify a chat completion preset.<br>
Fixed an issue where reasoning models could get stuck if the token limit was unable to fit the reasoning content.

#### v1.0.1
Added option to limit response length.