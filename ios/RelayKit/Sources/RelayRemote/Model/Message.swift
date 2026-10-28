import Foundation

/// `shared/projects/messages.ts` ChatMessage.
public struct ChatMessage: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    /// "user" | "assistant"
    public var role: String
    public var body: String
    /// "complete" | "streaming" | "failed" | "cancelled"
    public var status: String
    public var created: Int64
    public var provider: String
    public var version: Int64
    public var error: String?
    public var sentSettings: ResumeSettings?
    public var resumed: Bool?
    public var handedOver: Bool?
    public var compaction: Bool?
    public var compactSummary: String?
    public var compactedFrom: Double?
    public var handoff: AgentHandoff?
    public var reload: JSON?
    public var worktreeCommand: WorktreeCommandRun?
    public var unprompted: Bool?
    public var context: ContextUsage?
    public var cost: Double?
    public var streamed: JSON?
    public var model: TurnModel?
    public var proposedPlan: Bool?
    public var steered: Bool?
    public var asyncQuestionAnswer: Bool?
    public var pageAnswer: PageAnswer?
    public var unread: Bool?
    public var missed: Bool?
    public var side: Bool?
    public var images: [ChatImage]?
    public var skills: [SentSkill]?
    public var activity: [AgentActivity]?
    public var trace: [AgentTrace]?
    /// Dropped finished calls by kind ("command", …, "failed").
    public var traceDropped: [String: Int]?
    /// Trace entries a finished turn's copy left out; `messageSteps` has them. From `Bridge.stepsOnOpen`.
    public var stepsLeftOut: Int?
    /// What that turn's heading reads with every step, which the calls held can't count.
    public var stepsSummary: String?
    public var questions: [AsyncAgentQuestions]?
    /// Watch notes (shared/watch); untyped until a feature needs them.
    public var notes: [JSON]?
    public var renders: [HtmlRender]?
    public var preview: TurnPreview?
    public var changes: [TurnFileChange]?
    public var forkPoint: ForkPoint?
    public var signIn: String?
    public var ended: Int64?
    public var author: String?
    public var authorId: String?
    public var fromThread: String?
    /// On the message that asks a second opinion: what it asks about, shown in place of the prompt.
    public var secondOpinion: SecondOpinionAsked?
    public var seq: Int64?
    public var parentId: String?
    public var pending: Bool?

    public var streaming: Bool { status == "streaming" }
}

public struct AgentActivity: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    /// "command" | "file" | "read" | "search" | "web" | "agent" | "tool"
    public var kind: String
    public var label: String
    /// "running" | "complete" | "failed" | "stopped"
    public var status: String
    public var detail: String?
    public var questionAnswers: [AskedQuestion]?
    /// Characters the desktop left out of `detail`; `activityDetail` has them all.
    public var detailCut: Int?
    public var parentId: String?
    public var progress: String?
    public var mcp: McpCall?
    public var image: String?
    /// What the call did, read by the desktop from its command or tool; from `Bridge.traceTree`.
    public var actions: [CallAction]?
    /// The call wrote code, left out of the thread; `activityWritten` has it.
    public var wroteCode: Bool?
}

public struct McpCall: Codable, Sendable, Equatable {
    public var server: String
    public var tool: String
}

public struct AskedQuestion: Codable, Sendable, Equatable {
    public var question: String
    public var answer: String
}

/// `{kind:"commentary", id, text} | {kind:"activity", id, activity}`, flattened.
public struct AgentTrace: Codable, Sendable, Equatable, Identifiable {
    public var kind: String
    public var id: String
    public var text: String?
    public var activity: AgentActivity?

    public var isCommentary: Bool { kind == "commentary" }
}

public struct ChatImage: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var mimeType: String
    public var sizeBytes: Int64
}

public struct SentSkill: Codable, Sendable, Equatable {
    public var name: String
    public var label: String
}

public struct AgentQuestion: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var header: String?
    public var question: String
    public var isSecret: Bool?
    public var multiple: Bool?
    public var allowCustomAnswer: Bool?
    public var options: [QuestionOption]?
}

public struct QuestionOption: Codable, Sendable, Equatable {
    public var label: String
    public var description: String?
    public var value: String?
    public var selectionValue: String { value ?? label }
}

public struct AsyncAgentQuestions: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var page: HtmlRender?
    public var questions: [AgentQuestion]
    public var answers: [String: [String]]?
    public var dismissed: Bool?
}

public struct HtmlRender: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var pages: [HtmlRenderPage]
    public var created: Int64
}

public struct HtmlRenderPage: Codable, Sendable, Equatable {
    public var label: String?
    public var heights: [Double]?
}

public struct TurnFileChange: Codable, Sendable, Equatable {
    public var path: String
    public var additions: Int
    public var deletions: Int
    public var binary: Bool?
    public var revertedBy: String?
}

public struct ContextUsage: Codable, Sendable, Equatable {
    public var usedTokens: Int64
    public var maxTokens: Int64?
    public var totalTokens: Int64?
    public var cache: PromptCache?
}

public struct PromptCache: Codable, Sendable, Equatable {
    public var at: Int64
    public var ttlMs: Int64
}

public struct TurnModel: Codable, Sendable, Equatable {
    public var name: String
    public var byDefault: Bool?
    public var effort: String?
    public var effortByDefault: Bool?
    public var fast: Bool?
    public var window: String?
    public var plan: Bool?
}

public struct PageAnswer: Codable, Sendable, Equatable {
    public var title: String
    public var skipped: Bool?
}

public struct AgentHandoff: Codable, Sendable, Equatable {
    public var from: String
    public var to: String
    public var computer: String?
    public var byRelay: Bool?
}

public struct WorktreeCommandRun: Codable, Sendable, Equatable {
    public var kind: String
    public var command: String
    public var output: String
    public var copied: [String]?
    public var exitCode: Int?
    public var stopped: String?
}

public struct TurnPreview: Codable, Sendable, Equatable {
    public var url: String
    public var title: String
    public var at: Int64
    public var shot: Bool?
}

public struct ForkPoint: Codable, Sendable, Equatable {
    public var thread: String
    public var at: String
}

/// The desktop's `choiceSchema` requires `fast`, and a missing effort reads as "medium", not "".
public struct ModelChoice: Codable, Sendable, Equatable {
    public var model: String
    public var fast: Bool
    public var reasoningEffort: String

    public init(model: String, fast: Bool = false, reasoningEffort: String = "") {
        self.model = model
        self.fast = fast
        self.reasoningEffort = reasoningEffort
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        model = try c.decode(String.self, forKey: .model)
        fast = try c.decodeIfPresent(Bool.self, forKey: .fast) ?? false
        reasoningEffort = try c.decodeIfPresent(String.self, forKey: .reasoningEffort) ?? ""
    }
}

/// Which agent carries a message, and how (`resumeSettingsSchema`).
public struct ResumeSettings: Codable, Sendable, Equatable {
    public var provider: String
    public var choice: ModelChoice
    public var contextWindow: String?
    public var runtimeMode: String
    public var interactionMode: String

    public init(
        provider: String, choice: ModelChoice, contextWindow: String? = nil, runtimeMode: String,
        interactionMode: String
    ) {
        self.provider = provider
        self.choice = choice
        self.contextWindow = contextWindow
        self.runtimeMode = runtimeMode
        self.interactionMode = interactionMode
    }
}

/// `shared/remote-models.ts` MessageSteps: a finished turn's steps, which its folded copy left out.
public struct MessageSteps: Codable, Sendable, Equatable {
    public var trace: [AgentTrace]?
    public var activity: [AgentActivity]?
    public var traceDropped: [String: Int]?

    public init(trace: [AgentTrace]? = nil, activity: [AgentActivity]? = nil, traceDropped: [String: Int]? = nil) {
        self.trace = trace
        self.activity = activity
        self.traceDropped = traceDropped
    }
}
