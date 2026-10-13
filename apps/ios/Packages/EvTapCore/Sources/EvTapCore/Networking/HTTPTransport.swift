import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Abstraction over URLSession so the client can be unit-tested with canned responses.
public protocol HTTPTransport: Sendable {
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession transport (completion-handler based so it also works on swift-corelibs-foundation),
/// cancelling the data task when the calling Swift task is cancelled.
public struct URLSessionTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let box = TaskBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, HTTPURLResponse), Error>) in
                let task = session.dataTask(with: request) { data, response, error in
                    if let error {
                        cont.resume(throwing: error)
                    } else if let http = response as? HTTPURLResponse {
                        cont.resume(returning: (data ?? Data(), http))
                    } else {
                        cont.resume(throwing: URLError(.badServerResponse))
                    }
                }
                box.set(task)
                task.resume()
            }
        } onCancel: {
            box.cancel()
        }
    }
}

/// Holds the data task so the cancellation handler (which may run on any thread) can cancel it.
private final class TaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionDataTask?
    private var cancelled = false

    func set(_ t: URLSessionDataTask) {
        lock.lock()
        task = t
        let wasCancelled = cancelled
        lock.unlock()
        if wasCancelled { t.cancel() }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let t = task
        lock.unlock()
        t?.cancel()
    }
}

/// `multipart/form-data` body with a single file field.
public struct MultipartForm: Sendable {
    public let boundary: String
    public let body: Data

    public init(fileField: String, filename: String, mimeType: String, data: Data, boundary: String = "EvTap-\(UUID().uuidString)") {
        self.boundary = boundary
        var b = Data()
        b.append(Data("--\(boundary)\r\n".utf8))
        b.append(Data("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(filename)\"\r\n".utf8))
        b.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        b.append(data)
        b.append(Data("\r\n--\(boundary)--\r\n".utf8))
        body = b
    }

    public var contentType: String { "multipart/form-data; boundary=\(boundary)" }
}
