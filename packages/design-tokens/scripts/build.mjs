// Generates platform token files from tokens.json → dist/{tokens.css, EvTapTokens.swift, EvTapTokens.kt, tokens.ts}
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const t = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json'), 'utf8'));
const out = (f, s) => fs.writeFileSync(path.join(root, 'dist', f), s);
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const header = (c) => `${c} GENERATED from packages/design-tokens/tokens.json — do not edit (pnpm --filter @evtap/design-tokens build)\n`;

// ── CSS custom properties (light default, dark via [data-theme=dark] and prefers-color-scheme)
const cssVars = (o) => Object.entries(o).map(([k, v]) => `  --c-${kebab(k)}: ${v};`).join('\n');
let css = header('/*').replace('\n', ' */\n');
css += `:root {\n${cssVars(t.color.light)}\n`;
css += `  --font-display: '${t.font.display}', ui-sans-serif, system-ui, sans-serif;\n  --font-body: '${t.font.body}', ui-sans-serif, system-ui, sans-serif;\n`;
for (const [k, v] of Object.entries(t.radius)) css += `  --r-${k}: ${v}px;\n`;
for (const [k, v] of Object.entries(t.space)) css += `  --s-${k}: ${v}px;\n`;
for (const [k, v] of Object.entries(t.shadow)) css += `  --shadow-${k}: ${v};\n`;
css += `  --blur-glass: ${t.blur.glass}px;\n  --ease: ${t.motion.easing};\n  --dur-fast: ${t.motion.fast}ms;\n  --dur-base: ${t.motion.base}ms;\n  --dur-slow: ${t.motion.slow}ms;\n}\n`;
css += `[data-theme='dark'] {\n${cssVars(t.color.dark)}\n  --shadow-card: 0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.6);\n}\n`;
css += `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${cssVars(t.color.dark).replace(/^/gm, '  ')}\n  }\n}\n`;
out('tokens.css', css);

// ── TypeScript (for JS consumers: charts, canvas)
out('tokens.ts', header('//') + `export const tokens = ${JSON.stringify(t, null, 2)} as const;\nexport default tokens;\n`);

// ── Swift (SwiftUI)
const hex = (h) => {
  if (h.startsWith('rgba')) {
    const [r, g, b, a] = h.match(/[\d.]+/g).map(Number);
    return `Color(.sRGB, red: ${(r / 255).toFixed(4)}, green: ${(g / 255).toFixed(4)}, blue: ${(b / 255).toFixed(4)}, opacity: ${a})`;
  }
  const n = parseInt(h.slice(1), 16);
  return `Color(.sRGB, red: ${(((n >> 16) & 255) / 255).toFixed(4)}, green: ${(((n >> 8) & 255) / 255).toFixed(4)}, blue: ${((n & 255) / 255).toFixed(4)}, opacity: 1)`;
};
let swift = header('//') + `import SwiftUI\n\n/// Light/dark adaptive colours. Usage: \`EvColor.ink\`\npublic enum EvColor {\n`;
for (const k of Object.keys(t.color.light)) {
  swift += `    public static let ${k} = Color(light: ${hex(t.color.light[k])}, dark: ${hex(t.color.dark[k])})\n`;
}
swift += `}\n\npublic enum EvRadius {\n${Object.entries(t.radius).map(([k, v]) => `    public static let ${k}: CGFloat = ${v}`).join('\n')}\n}\n\n`;
swift += `public enum EvSpace {\n${Object.entries(t.space).map(([k, v]) => `    public static let s${k}: CGFloat = ${v}`).join('\n')}\n}\n\n`;
swift += `public enum EvFontName {\n    public static let display = "${t.font.display}"\n    public static let body = "${t.font.body}"\n}\n\n`;
swift += `public struct EvTextStyle { public let size: CGFloat; public let line: CGFloat; public let weight: Font.Weight; public let display: Bool; public let tracking: CGFloat }\n`;
const sw = (w) => ({ 300: '.light', 400: '.regular', 500: '.medium', 600: '.semibold', 700: '.bold' })[w];
swift += `public enum EvType {\n${Object.entries(t.type).map(([k, v]) => `    public static let ${k} = EvTextStyle(size: ${v.size}, line: ${v.line}, weight: ${sw(v.weight)}, display: ${v.family === 'display'}, tracking: ${v.tracking})`).join('\n')}\n}\n\n`;
swift += `public extension Color {\n    /// Dynamic colour that follows the system appearance.\n    init(light: Color, dark: Color) {\n        #if canImport(UIKit)\n        self = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })\n        #else\n        self = light\n        #endif\n    }\n}\n`;
out('EvTapTokens.swift', swift);

// ── Kotlin (Jetpack Compose)
const kc = (h) => {
  if (h.startsWith('rgba')) {
    const [r, g, b, a] = h.match(/[\d.]+/g).map(Number);
    const A = Math.round(a * 255);
    return `Color(0x${[A, r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()})`;
  }
  return `Color(0xFF${h.slice(1).toUpperCase()})`;
};
let kt = header('//') + `package az.evtap.app.ui.theme\n\nimport androidx.compose.runtime.Immutable\nimport androidx.compose.ui.graphics.Color\nimport androidx.compose.ui.unit.dp\nimport androidx.compose.ui.unit.sp\n\n@Immutable\ndata class EvColors(\n${Object.keys(t.color.light).map((k) => `    val ${k}: Color,`).join('\n')}\n)\n\n`;
kt += `val EvLightColors = EvColors(\n${Object.entries(t.color.light).map(([k, v]) => `    ${k} = ${kc(v)},`).join('\n')}\n)\n\n`;
kt += `val EvDarkColors = EvColors(\n${Object.entries(t.color.dark).map(([k, v]) => `    ${k} = ${kc(v)},`).join('\n')}\n)\n\n`;
kt += `object EvRadius {\n${Object.entries(t.radius).map(([k, v]) => `    val ${k} = ${v}.dp`).join('\n')}\n}\n\n`;
kt += `object EvSpace {\n${Object.entries(t.space).map(([k, v]) => `    val s${k} = ${v}.dp`).join('\n')}\n}\n\n`;
kt += `data class EvTextSpec(val size: Float, val line: Float, val weight: Int, val display: Boolean, val tracking: Float)\n\nobject EvTypeSpec {\n${Object.entries(t.type).map(([k, v]) => `    val ${k} = EvTextSpec(${v.size}f, ${v.line}f, ${v.weight}, ${v.family === 'display'}, ${v.tracking}f)`).join('\n')}\n}\n`;
out('EvTapTokens.kt', kt);
console.log('✔ design tokens → dist/{tokens.css,tokens.ts,EvTapTokens.swift,EvTapTokens.kt}');
