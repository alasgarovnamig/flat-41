import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Server → client realtime events (see `REALTIME` in `packages/shared/src/api.ts`).
public enum RealtimeEvent: Sendable, Equatable {
    case messageNew(Message)
    case conversationRead(ConversationReadEvent)
    case notificationNew(AppNotification)
    case paymentUpdated(Payment)
    case typing(TypingEvent)
    case connected
    case disconnected
}

/// Plain-WebSocket frame codec: every frame is UTF-8 JSON `{ "event": "<name>", "data": <payload> }`.
public enum RealtimeCodec {
    public enum Incoming: Sendable, Equatable {
        case event(RealtimeEvent)
        case ping
        case unknown(String)
    }

    private struct Envelope: Decodable { let event: String }
    private struct Payload<T: Decodable>: Decodable { let data: T }

    public static func decode(_ text: String) -> Incoming? {
        let data = Data(text.utf8)
        let decoder = JSONCoding.decoder()
        guard let env = try? decoder.decode(Envelope.self, from: data) else { return nil }
        func payload<T: Decodable>(_ type: T.Type) -> T? { try? decoder.decode(Payload<T>.self, from: data).data }
        switch env.event {
        case "ping": return .ping
        case "message:new": return payload(Message.self).map { .event(.messageNew($0)) }
        case "conversation:read": return payload(ConversationReadEvent.self).map { .event(.conversationRead($0)) }
        case "notification:new": return payload(AppNotification.self).map { .event(.notificationNew($0)) }
        case "payment:updated": return payload(Payment.self).map { .event(.paymentUpdated($0)) }
        case "typing": return payload(TypingEvent.self).map { .event(.typing($0)) }
        default: return .unknown(env.event)
        }
    }

    public static let pong = #"{"event":"pong"}"#

    public static func typing(conversationId: String) -> String {
        struct Frame: Encodable {
            struct D: Encodable { let conversationId: String }
            let event = "typing"
            let data: D
        }
        let data = (try? JSONCoding.encoder().encode(Frame(data: .init(conversationId: conversationId)))) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// `ws(s)://<API host>/ws?token=<accessToken>`
    public static func socketURL(origin: URL, token: String) -> URL? {
        guard var comps = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        let base = comps.path.hasSuffix("/") ? String(comps.path.dropLast()) : comps.path
        comps.path = base + "/ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        return comps.url
    }

    /// Exponential back-off 1 s → 30 s (attempt starts at 0).
    public static func backoff(attempt: Int) -> Double {
        min(30, pow(2, Double(max(0, min(attempt, 10)))))
    }
}

/// Server close code for an invalid / missing token.
public let realtimeUnauthorizedCloseCode = 4401

/// One WebSocket connection (abstracted for tests).
public protocol WebSocketConnection: Sendable {
    func send(_ text: String) async throws
    func receive() async throws -> String
    func close()
    /// Close code reported by the server once the socket closed (0 when unknown).
    var closeCode: Int { get }
}

public protocol WebSocketFactory: Sendable {
    func connect(to url: URL) -> WebSocketConnection
}

/// URLSessionWebSocketTask-backed connection.
public struct URLSessionWebSocketFactory: WebSocketFactory, @unchecked Sendable {
    private let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }

    public func connect(to url: URL) -> WebSocketConnection {
        let task = session.webSocketTask(with: url)
        task.resume()
        return URLSessionWebSocketConnection(task: task)
    }
}

/// Uses the completion-handler APIs (available on Darwin and swift-corelibs-foundation alike).
private struct URLSessionWebSocketConnection: WebSocketConnection, @unchecked Sendable {
    let task: URLSessionWebSocketTask

    func send(_ text: String) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            task.send(.string(text)) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    func receive() async throws -> String {
        let message: URLSessionWebSocketTask.Message = try await withCheckedThrowingContinuation { cont in
            task.receive { result in cont.resume(with: result) }
        }
        switch message {
        case .string(let s): return s
        case .data(let d): return String(decoding: d, as: UTF8.self)
        @unknown default: return ""
        }
    }

    func close() { task.cancel(with: .normalClosure, reason: nil) }

    var closeCode: Int { task.closeCode.rawValue }
}

/// Realtime connection manager: connects with the current access token, answers pings, reconnects with
/// exponential back-off and refreshes the token first when the server closed with 4401.
/// Consume `events` (single consumer — the app fans out from there).
public actor RealtimeClient {
    public nonisolated let events: AsyncStream<RealtimeEvent>
    private let continuation: AsyncStream<RealtimeEvent>.Continuation
    private let origin: URL
    private let tokens: TokenManager
    private let factory: WebSocketFactory
    private let refresh: @Sendable () async -> RefreshOutcome
    private var connection: WebSocketConnection?
    private var loop: Task<Void, Never>?
    private var attempt = 0
    private var lastTypingSent: [String: Date] = [:]

    public init(origin: URL, tokens: TokenManager, factory: WebSocketFactory = URLSessionWebSocketFactory(),
                refresh: @escaping @Sendable () async -> RefreshOutcome) {
        self.origin = origin
        self.tokens = tokens
        self.factory = factory
        self.refresh = refresh
        let (stream, cont) = AsyncStream<RealtimeEvent>.makeStream(bufferingPolicy: .bufferingNewest(100))
        events = stream
        continuation = cont
    }

    public var isRunning: Bool { loop != nil }

    /// Starts (or keeps) the connection loop. Safe to call repeatedly.
    public func start() {
        guard loop == nil else { return }
        attempt = 0
        loop = Task { [weak self] in await self?.run() }
    }

    /// Stops the loop and closes the socket (logout / app in background).
    public func stop() {
        loop?.cancel()
        loop = nil
        connection?.close()
        connection = nil
    }

    /// Client typing event, throttled to one per 2 s per conversation.
    public func sendTyping(conversationId: String) async {
        let now = Date()
        if let last = lastTypingSent[conversationId], now.timeIntervalSince(last) < 2 { return }
        lastTypingSent[conversationId] = now
        try? await connection?.send(RealtimeCodec.typing(conversationId: conversationId))
    }

    private func run() async {
        while !Task.isCancelled {
            guard let token = await tokens.accessToken, let url = RealtimeCodec.socketURL(origin: origin, token: token) else {
                // Signed out: nothing to do until start() is called again.
                loop = nil
                return
            }
            let conn = factory.connect(to: url)
            connection = conn
            var receivedAny = false
            do {
                while !Task.isCancelled {
                    let text = try await conn.receive()
                    if !receivedAny {
                        receivedAny = true
                        attempt = 0
                        continuation.yield(.connected)
                    }
                    switch RealtimeCodec.decode(text) {
                    case .ping?: try? await conn.send(RealtimeCodec.pong)
                    case .event(let e)?: continuation.yield(e)
                    case .unknown?, nil: break
                    }
                }
            } catch {
                // fall through to reconnect
            }
            conn.close()
            connection = nil
            if receivedAny { continuation.yield(.disconnected) }
            if Task.isCancelled { break }
            if conn.closeCode == realtimeUnauthorizedCloseCode {
                if await refresh() == .loggedOut {
                    loop = nil
                    return
                }
            }
            let delay = RealtimeCodec.backoff(attempt: attempt)
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }
}
