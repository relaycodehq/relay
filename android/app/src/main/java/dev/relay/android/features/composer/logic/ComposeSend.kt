package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.PastedImage
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.model.SentSkill
import kotlinx.serialization.Serializable

// shared/compose-send.ts, recipient.ts, remote-compose.ts and new-thread-models.ts.

val byDefault = ModelChoice(model = "", fast = false, reasoningEffort = "")

/** Who answers: an agent the text names, else the picked one. */
fun draftRecipient(text: String, picked: String) = agentMention(text)?.provider ?: picked

/** Who a sent message went to; "message" is a note no agent answers. */
fun recipient(send: ProjectChatSend) = send.to ?: agentMention(send.body)?.provider ?: "message"

/** The agent and model it went with, back in the picker when it's taken back to edit (the text loses its mention); null for a note. */
fun sentWith(send: ProjectChatSend): ResumeSettings? =
    recipient(send).takeIf { it != "message" }?.let {
        ResumeSettings(it, send.choice, send.contextWindow, send.runtimeMode, send.interactionMode)
    }

/** What a composer sends with, once the agent's model is picked. */
data class SendSettings(
    val to: String,
    val choice: ModelChoice,
    val contextWindow: String? = null,
    val runtimeMode: String,
    val interactionMode: String,
)

data class SendOptions(
    /** An answer is running: null when not, else whether the message steers it. */
    val steer: Boolean? = null,
    val sendAt: Long? = null,
    val side: Boolean = false,
    val parentId: String? = null,
    val images: List<PastedImage>? = null,
    val skills: List<SentSkill>? = null,
)

/** A message as every composer sends it, desktop and phone alike. */
fun buildSend(settings: SendSettings, text: String, options: SendOptions = SendOptions(), id: String = ""): ProjectChatSend {
    val body = text.trim()
    val to = draftRecipient(body, settings.to)
    // Another agent named in the text runs on its Default.
    val picked = to == settings.to
    val choice = if (picked) settings.choice else byDefault
    val contextWindow = if (picked) settings.contextWindow else null
    val fast = if (to == "message") choice.fast else fastFor(to, choice.fast)
    val sendAt = options.sendAt?.takeIf { it != 0L }
    return ProjectChatSend(
        id = id,
        sendAt = sendAt,
        delivery = when {
            sendAt != null || options.steer == null -> null
            options.steer -> "steer"
            else -> "queue"
        },
        // Desktops before `to` read who answers from the mention, so it stays.
        body = if (to == "message" || agentMentionPattern.containsMatchIn(body)) body else "@$to $body".trim(),
        to = to,
        // Older desktops require an agent even on a note.
        provider = if (to == "message") "codex" else to,
        choice = choice.copy(fast = fast),
        contextWindow = windowFor(to, choice.model, contextWindow),
        runtimeMode = settings.runtimeMode,
        interactionMode = settings.interactionMode,
        side = if (options.side) true else null,
        parentId = options.parentId?.takeIf { it.isNotEmpty() },
        images = options.images?.takeIf { it.isNotEmpty() },
        skills = options.skills?.takeIf { it.isNotEmpty() },
    )
}

fun implementPlan(provider: String) = "@$provider Implement the plan from your previous response."

/** The go-ahead for `planner`'s plan, and the settings kept afterwards: that agent, in Build. */
fun planGoAhead(settings: SendSettings, planner: String): Pair<ProjectChatSend, SendSettings> {
    val onPlanner = if (settings.to == planner) settings else settings.copy(choice = byDefault, contextWindow = null)
    val next = onPlanner.copy(to = planner, interactionMode = "default")
    return buildSend(next, implementPlan(planner)) to next
}

fun ResumeSettings.toSend() = SendSettings(provider, choice, contextWindow, runtimeMode, interactionMode)
fun SendSettings.toResume() = ResumeSettings(to, choice, contextWindow, runtimeMode, interactionMode)

/** The parts of the desktop's AI settings a new thread opens on. */
@Serializable
data class NewThreadAI(
    val threadProvider: String? = null,
    val questionsProvider: String? = null,
    val questions: ModelChoice? = null,
    /** The agents as Settings → Agents lists them; older desktops leave both out. */
    val agentOrder: List<String> = emptyList(),
    val agentsOff: List<String> = emptyList(),
)

typealias NewThreadModels = Map<String, NewThreadModel>

private fun known(provider: String?) = provider?.takeIf { isAgentProvider(it) }

/** A new thread's composer as the desktop starts one: the remembered access (else Auto-accept edits), Build, the remembered model. */
fun newThreadSettings(
    ai: NewThreadAI?,
    provider: String? = null,
    models: NewThreadModels = emptyMap(),
    runtimeMode: String? = null,
): ResumeSettings {
    val p = provider ?: known(ai?.threadProvider) ?: "codex"
    val codex = if (p == "codex" && ai?.questionsProvider == "codex") ai.questions else null
    val mode = runtimeMode?.takeIf { m -> runtimeModes.any { it.value == m } } ?: DEFAULT_RUNTIME_MODE
    return withRememberedModel(ResumeSettings(p, codex ?: byDefault, null, mode, "default"), models)
}

/** `settings` on the model its agent last ran with, when there is one. */
fun withRememberedModel(settings: ResumeSettings, models: NewThreadModels): ResumeSettings {
    val remembered = models[settings.provider] ?: return settings
    val c = remembered.choice
    // A blank pick is the Default, which `settings` already has.
    if (c.model.isEmpty() && c.reasoningEffort.isEmpty() && !c.fast) return settings
    return settings.copy(choice = c, contextWindow = remembered.contextWindow?.takeIf { it.isNotEmpty() })
}

/** desktopNewThread's pick: the agent last picked for a new thread, unless it's switched off since, else the default one. */
fun newThreadSettingsFrom(last: String?, ai: NewThreadAI?, models: NewThreadModels, runtimeMode: String? = null) =
    newThreadSettings(
        ai, known(last)?.takeUnless { it in ai?.agentsOff.orEmpty() } ?: known(ai?.threadProvider), models, runtimeMode,
    )

/** The same composer on another agent: its model goes back to Default. */
fun switchAgent(settings: ResumeSettings, provider: String): ResumeSettings =
    if (provider == settings.provider) settings
    else settings.copy(provider = provider, choice = byDefault, contextWindow = null)

/** `settings` after a composer command. */
fun withComposerChange(
    settings: ResumeSettings,
    change: ComposerChange,
    catalogs: ModelCatalogs,
    switchTo: (ResumeSettings, String) -> ResumeSettings = ::switchAgent,
): ResumeSettings = when (change) {
    is ComposerChange.Provider -> switchTo(settings, change.provider)
    is ComposerChange.Model -> {
        val p = change.provider
        val on = switchTo(settings, p)
        on.copy(
            choice = onModel(p, on.choice, change.model, modelEfforts(p, change.model, catalogs), catalogs[p]),
            contextWindow = windowFor(p, change.model, on.contextWindow),
        )
    }
    is ComposerChange.Effort -> settings.copy(choice = settings.choice.copy(reasoningEffort = change.reasoningEffort))
    is ComposerChange.Permissions -> settings.copy(runtimeMode = change.runtimeMode)
    is ComposerChange.Plan -> settings.copy(interactionMode = if (change.plan) "plan" else "default")
    is ComposerChange.Fast -> settings.copy(choice = settings.choice.copy(fast = change.fast))
}

fun remotePlanGoAhead(settings: ResumeSettings, planner: String, id: String): Pair<ProjectChatSend, ResumeSettings> {
    val (send, next) = planGoAhead(settings.toSend(), planner)
    return send.copy(id = id) to next.toResume()
}

/** When the thread's latest send went to another conversation, the agent holding this one answers next. */
fun conversationSettings(last: ResumeSettings, lastParentId: String?, rootId: String?, holder: String?): ResumeSettings {
    val elsewhere = lastParentId != rootId
    return if (elsewhere && holder != null) switchAgent(last, holder) else last
}

/** The message the desktop's composer would send for these settings. */
fun composeSend(
    settings: ResumeSettings,
    body: String,
    id: String,
    parentId: String? = null,
    side: Boolean = false,
    delivery: String? = null,
    sendAt: Long? = null,
    images: List<PastedImage>? = null,
): ProjectChatSend = buildSend(
    settings.toSend(),
    body,
    SendOptions(steer = delivery?.let { it == "steer" }, sendAt = sendAt, side = side, parentId = parentId, images = images),
    id,
)

/** The agent a sent message went to and its model; none when it went to people. */
fun sentModel(send: ProjectChatSend): Pair<String, NewThreadModel>? {
    if (recipient(send) != send.provider) return null
    return send.provider to NewThreadModel(send.choice, windowFor(send.provider, send.choice.model, send.contextWindow))
}

fun sameModel(a: NewThreadModel?, b: NewThreadModel?) =
    a?.choice?.model == b?.choice?.model && a?.choice?.reasoningEffort == b?.choice?.reasoningEffort &&
        a?.choice?.fast == b?.choice?.fast && a?.contextWindow == b?.contextWindow
