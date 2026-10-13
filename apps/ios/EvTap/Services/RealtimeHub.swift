import Foundation
import Observation
import EvTapCore

/// Main-actor fan-out of `RealtimeClient.events` (the stream has a single consumer) + the unread badge.
@MainActor
@Observable
final class RealtimeHub {
    private(set) var unreadMessages = 0
    private(set) var isConnected = false

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let client: RealtimeClient
    @ObservationIgnored private var consumer: Task<Void, Never>?
    @ObservationIgnored private var subscribers: [UUID: @MainActor (RealtimeEvent) -> Void] = [:]

    init(api: APIClient, tokens: TokenManager) {
        self.api = api
        self.client = RealtimeClient(origin: api.origin, tokens: tokens) { [api] in
            // Refresh through a cheap authenticated call; the client's single-flight refresh does the work.
            do {
                _ = try await api.send(API.unreadCount())
                return .refreshed
            } catch let e as APIError where e.isUnauthorized {
                return .loggedOut
            } catch {
                return .failed
            }
        }
    }

    func start() {
        if consumer == nil {
            let stream = client.events
            consumer = Task { [weak self] in
                for await event in stream {
                    self?.handle(event)
                }
            }
        }
        Task { await client.start() }
        Task { await refreshUnread() }
    }

    func stop() {
        Task { await client.stop() }
        unreadMessages = 0
        isConnected = false
    }

    /// App returned to the foreground: make sure the socket is up and counters are fresh.
    func resume() {
        guard AppServices.shared.session.isSignedIn else { return }
        Task { await client.start() }
        Task { await refreshUnread() }
    }

    func subscribe(_ handler: @escaping @MainActor (RealtimeEvent) -> Void) -> UUID {
        let id = UUID()
        subscribers[id] = handler
        return id
    }

    func unsubscribe(_ id: UUID) { subscribers[id] = nil }

    func sendTyping(conversationId: String) {
        Task { await client.sendTyping(conversationId: conversationId) }
    }

    func refreshUnread() async {
        let r = try? await api.send(API.unreadCount())
        if let r { unreadMessages = r.count }
    }

    private func handle(_ event: RealtimeEvent) {
        let bus = AppServices.shared.bus
        switch event {
        case .connected: isConnected = true
        case .disconnected: isConnected = false
        case .messageNew(let m):
            bus.bump(.conversations)
            if m.senderId != AppServices.shared.session.me?.id { Task { await refreshUnread() } }
        case .conversationRead:
            bus.bump(.conversations)
        case .notificationNew(let n):
            bus.bump(.notifications, .me)
            AppServices.shared.toast.show(n.title)
        case .paymentUpdated(let p):
            bus.bump(.payments)
            if p.status.isFinal { bus.paymentFinished() }
        case .typing:
            break
        }
        for handler in subscribers.values { handler(event) }
    }
}
