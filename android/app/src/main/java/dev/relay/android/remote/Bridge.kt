package dev.relay.android.remote

/** `shared/remote.ts` bridge versions: what a desktop speaking at least that many takes. */
object Bridge {
    /** This app's own bridge, sent with `pair`/`auth`. */
    const val VERSION = 33
    const val MESSAGE_BATCHES = 31
    /** Sends may ask for the `read-only` runtime mode. */
    const val READ_ONLY_MODE = 32
    /** Phones may attach any file (`uploadFile`). */
    const val FILES = 33
    const val DEFAULT_PORT = 47821

    const val RECIPIENT = 11
    const val HANDOFF = 11
    const val PHONE_UPDATES = 11
    const val READ_ALOUD = 12
    const val ACTIVITY_DETAIL = 13
    const val AWAY = 13
    const val IMAGE = 14
    const val COMPACT = 14
    const val SUBAGENTS = 15
    const val TITLE = 15
    const val MARKED_UNREAD = 15
    const val WORKSPACE = 16
    const val RENDER = 17
    const val LIVE_HANDOFF = 18
    const val DRAFTS = 19
    const val FOLDER_HANDOFF = 20
    const val START_HANDOFF = 20
    const val SKILLS = 21
    const val PREVIEW = 22
    const val NOTES = 22
    const val WORKSPACE_MOVES = 22
    /** Port tunnel frames (remote/tunnel) and `sites`. */
    const val TUNNEL = 23
    /** Takes `background` frames: batched events and a tick a minute while the app is away. */
    const val BACKGROUND = 29

    const val PHONE_DETAIL_PREVIEW = 600
    const val REMOTE_HISTORY = 100
    const val MAX_REMOTE_HISTORY = 1000
    const val MAX_DICTATION_CHUNK = 44_000
    const val MAX_READ_ALOUD_PULL = 3
    const val MAX_READ_ALOUD_TEXT = 1_000_000
    const val RENDER_MAX_PAGES = 12

    /** Calls given the desktop's two minutes instead of the usual quarter. */
    val slowRemoteMethods = setOf("sendDraft", "receiveHandoff", "handBack", "handoffUpload", "handoffDownload")
    val slowPhoneMethods = setOf(
        "sendProjectChat", "createProjectChat", "projectGitAction", "projectCommitMessage",
        "projectMergePlan", "projectMergeBranch", "projectCiStatus", "providerUsage",
        "regenerateProjectChatTitle",
    )

    /** `phoneDesktopMethods`: the desktop's own calls a phone may make through `desktop`. */
    val phoneDesktopMethods = setOf(
        "createProjectChat", "createScratch", "sendProjectChat", "cancelProjectChat", "respondProjectChat",
        "answerProjectChatQuestion", "setProjectChatQuestionDismissed", "projectChatQueueAction",
        "resumeProjectChat", "compactProjectChat", "reloadProjectChatSession", "rerunWorktreeSetup",
        "selectAgentWorktree", "resolveStoppedWork", "stopProjectChatPending", "projectChatAgents",
        "projectChatAgent", "stopProjectChatAgent", "triageProjectChat", "renameProjectChat",
        "regenerateProjectChatTitle", "markProjectChatSeen", "forkProjectChat", "rewindProjectTurn",
        "setLimitResume", "closeWatchNote", "projectChatImage", "projectChatReadImage",
        "projectChatQueuedImages", "threadNotes", "tickThreadNote", "removeThreadNote", "agentModels", "agentDefaults", "aiSettings", "newThreadAgent",
        "saveNewThreadAgent", "newThreadModels", "saveNewThreadModel", "newThreadRuntimeMode",
        "saveNewThreadRuntimeMode", "projectWorktree",
        "projectCommands", "providerUsage", "projectWorkingTree", "projectGitAction", "projectCiStatus",
        "projectMergePlan", "projectMergeBranch", "projectCommitMessage", "projectBranches",
        "projectChangeBranch", "projectHistory", "projectCommit", "projectFiles", "projectFile",
        "projectTasks", "stopProjectTask", "restartProjectTask",
    )
}
