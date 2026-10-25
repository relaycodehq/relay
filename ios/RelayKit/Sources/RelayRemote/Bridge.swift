/// `shared/remote-bridges.ts` bridge versions: what a desktop speaking at least that many takes.
public enum Bridge {
    /// This app's own bridge, sent with `pair`/`auth`.
    public static let version = 33
    public static let messageBatches = 31
    /// Sends may ask for the `read-only` runtime mode.
    public static let readOnlyMode = 32
    /// Phones may attach any file (`uploadFile`).
    public static let files = 33
    public static let defaultPort = 47821

    public static let recipient = 11
    public static let handoff = 11
    public static let phoneUpdates = 11
    public static let readAloud = 12
    public static let activityDetail = 13
    public static let away = 13
    public static let image = 14
    public static let compact = 14
    public static let subagents = 15
    public static let title = 15
    public static let markedUnread = 15
    public static let workspace = 16
    public static let render = 17
    public static let liveHandoff = 18
    public static let drafts = 19
    public static let folderHandoff = 20
    public static let startHandoff = 20
    public static let skills = 21
    public static let preview = 22
    public static let notes = 22
    public static let workspaceMoves = 22
    /// Port tunnel frames (Tunnel/) and `sites`.
    public static let tunnel = 23
    /// A thread's calls say what they did (`actions`) and whether they wrote code; `activityWritten`.
    public static let traceTree = 35

    /// The desktop counts as outdated below this.
    public static let oldestCurrent = 22

    public static let phoneDetailPreview = 600
    public static let remoteHistory = 100
    public static let maxRemoteHistory = 1000

    /// Calls given the desktop's two minutes instead of the usual quarter.
    public static let slowRemoteMethods: Set<String> = [
        "sendDraft", "receiveHandoff", "handBack", "handoffUpload", "handoffDownload",
    ]
    public static let slowPhoneMethods: Set<String> = [
        "sendProjectChat", "createProjectChat", "projectGitAction", "projectCommitMessage",
        "projectMergePlan", "projectMergeBranch", "projectCiStatus", "providerUsage",
        "regenerateProjectChatTitle", "search", "pullCiStatus", "pullMergeReadiness", "mergePull",
        "submitReview", "comment",
    ]
}
