const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function emit(level: keyof typeof levels, msg: string): void {
  if (levels[level] >= levels.info) {
    console.log(`[${level}] ${msg}`);
  }
}

export const logger = {
  debug: (msg: string) => emit('debug', msg),
  info: (msg: string) => emit('info', msg),
  warn: (msg: string) => emit('warn', msg),
  error: (msg: string) => emit('error', msg),
};
