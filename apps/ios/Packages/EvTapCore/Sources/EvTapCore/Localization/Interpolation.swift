import Foundation

/// `{name}` placeholder substitution used by every translated string ("{n} nights", "Balance: {amount}").
/// Same semantics as the web / old mobile `t()`: unknown placeholders are left as-is.
public enum Interpolation {
    public static func apply(_ template: String, _ args: [String: String]) -> String {
        guard !args.isEmpty, template.contains("{") else { return template }
        var out = ""
        out.reserveCapacity(template.count)
        var i = template.startIndex
        while i < template.endIndex {
            let ch = template[i]
            if ch == "{", let close = template[i...].firstIndex(of: "}") {
                let name = String(template[template.index(after: i)..<close])
                if !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }), let value = args[name] {
                    out += value
                    i = template.index(after: close)
                    continue
                }
            }
            out.append(ch)
            i = template.index(after: i)
        }
        return out
    }
}

/// Minimal Markdown → blocks for CMS pages (`GET /pages/:slug` bodies are Markdown, possibly with simple HTML).
/// Inline markup (bold, links) is left in the text for `AttributedString(markdown:)`.
public enum MarkdownBlock: Sendable, Equatable {
    case heading(level: Int, text: String)
    case bullet(String)
    case numbered(Int, String)
    case paragraph(String)
    case rule

    public static func parse(_ body: String) -> [MarkdownBlock] {
        let normalized = body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "<br>", with: "\n")
            .replacingOccurrences(of: "<br/>", with: "\n")
            .replacingOccurrences(of: "<br />", with: "\n")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: " ")))
                paragraph = []
            }
        }
        for raw in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = stripTags(String(raw)).trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            if line == "---" || line == "***" { flush(); blocks.append(.rule); continue }
            if line.hasPrefix("#") {
                let level = line.prefix(while: { $0 == "#" }).count
                let text = line.dropFirst(level).trimmingCharacters(in: .whitespaces)
                if level <= 6, !text.isEmpty { flush(); blocks.append(.heading(level: level, text: text)); continue }
            }
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("• ") {
                flush(); blocks.append(.bullet(String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces))); continue
            }
            if let dot = line.firstIndex(of: "."), let n = Int(line[..<dot]), line.index(after: dot) < line.endIndex, line[line.index(after: dot)] == " " {
                flush(); blocks.append(.numbered(n, String(line[line.index(dot, offsetBy: 2)...]))); continue
            }
            paragraph.append(line)
        }
        flush()
        return blocks
    }

    /// Removes simple HTML tags (`<p>`, `<strong>`, …) while keeping their text.
    static func stripTags(_ s: String) -> String {
        guard s.contains("<") else { return s }
        var out = ""
        var inTag = false
        for ch in s {
            if ch == "<" { inTag = true; continue }
            if ch == ">" && inTag { inTag = false; continue }
            if !inTag { out.append(ch) }
        }
        return out
    }
}
