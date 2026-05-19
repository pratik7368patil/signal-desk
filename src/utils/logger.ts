export type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  const configured = (process.env.SIGNALD_LOG_LEVEL as LogLevel | undefined) ?? "info";
  if (levelOrder[level] < levelOrder[configured]) {
    return;
  }
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta === undefined ? {} : { meta })
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger: Logger = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta)
};
