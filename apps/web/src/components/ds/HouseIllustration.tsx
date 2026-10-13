import { cn } from '@/lib/utils';

/** Arched window / door path: x, y = top-left of the bounding box. */
const arch = (x: number, y: number, w: number, h: number) => {
  const r = w / 2;
  return `M${x} ${y + h}V${y + r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h}Z`;
};

function ArchWindow({ x, y, w, h, bars = true }: { x: number; y: number; w: number; h: number; bars?: boolean }) {
  const r = w / 2;
  return (
    <g>
      <path d={arch(x - 5, y - 5, w + 10, h + 5)} className="hs-trim" />
      <path d={arch(x, y, w, h)} className="hs-glass" />
      <path d={`M${x + r} ${y + 4}V${y + h}M${x} ${y + r + 6}H${x + w}`} className="hs-mullion" />
      {bars && <path d={`M${x + 6} ${y + h - 30}H${x + w - 6}`} className="hs-mullion" />}
      <rect x={x - 8} y={y + h} width={w + 16} height={6} rx={2} className="hs-sill" />
    </g>
  );
}

function Railing({ x1, x2, y, h }: { x1: number; x2: number; y: number; h: number }) {
  const bars: string[] = [];
  for (let x = x1 + 6; x < x2; x += 9) bars.push(`M${x} ${y + 3}V${y + h}`);
  return (
    <g>
      <path d={bars.join('')} className="hs-rail" />
      <rect x={x1} y={y} width={x2 - x1} height={4} rx={2} className="hs-rail-top" />
      <path d={`M${x1} ${y + h / 2}H${x2}`} className="hs-rail" />
    </g>
  );
}

/**
 * Two-storey villa (hip roof, arched windows, balcony railings) drawn with design-token colours (see `.hs-*` in
 * globals.css) — light theme reads like the reference's white villa; dark theme becomes the same house at dusk with
 * lit windows. Decorative: aria-hidden. Edges fade into the canvas via a mask.
 */
export function HouseIllustration({ className }: { className?: string }) {
  const roofLines: string[] = [];
  for (let i = 0; i < 6; i++) {
    const y = 100 + i * 9;
    const inset = 60 - i * 9.5;
    roofLines.push(`M${70 + inset} ${y}H${570 - inset}`);
  }
  return (
    <svg viewBox="0 0 640 400" className={cn('house-illustration h-auto w-full', className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id="hs-glass-g" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" className="hs-glass-a" />
          <stop offset="1" className="hs-glass-b" />
        </linearGradient>
        <linearGradient id="hs-wall-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="hs-wall-a" />
          <stop offset="0.55" className="hs-wall-b" />
          <stop offset="1" className="hs-wall-a" />
        </linearGradient>
        <radialGradient id="hs-ground-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="hs-ground-a" />
          <stop offset="1" className="hs-ground-b" />
        </radialGradient>
      </defs>

      <ellipse cx="320" cy="368" rx="300" ry="26" fill="url(#hs-ground-g)" />

      {/* ground floor */}
      <rect x="64" y="252" width="512" height="114" fill="url(#hs-wall-g)" />
      <rect x="64" y="352" width="512" height="14" className="hs-plinth" />
      {/* upper floor */}
      <rect x="96" y="150" width="448" height="104" fill="url(#hs-wall-g)" />
      {/* side pilasters */}
      <rect x="64" y="252" width="14" height="114" className="hs-shade" />
      <rect x="562" y="252" width="14" height="114" className="hs-shade" />
      <rect x="96" y="150" width="12" height="104" className="hs-shade" />
      <rect x="532" y="150" width="12" height="104" className="hs-shade" />

      {/* roof */}
      <path d="M44 150L128 92H512L596 150Z" className="hs-roof" />
      <path d={roofLines.join('')} className="hs-roof-lines" />
      <rect x="38" y="148" width="564" height="9" rx="2" className="hs-eave" />
      <path d="M44 157H596V163H44Z" className="hs-eave-shadow" />

      {/* upper windows */}
      <ArchWindow x={150} y={170} w={62} h={74} />
      <rect x="268" y="168" width="104" height="80" rx="3" className="hs-trim" />
      <rect x="274" y="174" width="92" height="76" className="hs-glass" />
      <path d="M320 174V250M274 206H366" className="hs-mullion" />
      <ArchWindow x={428} y={170} w={62} h={74} />

      {/* balcony */}
      <rect x="78" y="250" width="484" height="9" rx="2" className="hs-eave" />
      <Railing x1={92} x2={548} y={214} h={36} />

      {/* wall lamps */}
      <rect x="252" y="286" width="7" height="14" rx="2" className="hs-lamp" />
      <rect x="381" y="286" width="7" height="14" rx="2" className="hs-lamp" />

      {/* ground floor windows & door */}
      <ArchWindow x={132} y={272} w={66} h={80} />
      <path d={arch(276, 268, 88, 86)} className="hs-trim" />
      <path d={arch(282, 274, 76, 80)} className="hs-glass" />
      <path d="M320 278V354" className="hs-mullion" />
      <ArchWindow x={442} y={272} w={66} h={80} />
      <Railing x1={120} x2={210} y={320} h={32} />
      <Railing x1={430} x2={520} y={320} h={32} />
    </svg>
  );
}
