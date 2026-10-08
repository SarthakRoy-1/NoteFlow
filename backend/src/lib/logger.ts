/** Minimal logger. Never pass secrets or note bodies to it. */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};
