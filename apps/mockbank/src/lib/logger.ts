import type { Config } from '../config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: Config['logLevel']): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (lvl: Level) => (msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const line = `${new Date().toISOString()} [mockbank] ${lvl.toUpperCase()} ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    (lvl === 'error' || lvl === 'warn' ? console.error : console.log)(line);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
