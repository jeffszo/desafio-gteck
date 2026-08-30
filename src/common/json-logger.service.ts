import type { LoggerService } from "@nestjs/common";


export class JsonLoggerService implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write("log", message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write("error", message, context, trace ? { trace } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }

  private write(
    level: "log" | "error" | "warn" | "debug" | "verbose",
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: typeof message === "string" ? message : JSON.stringify(message),
      ...extra,
    };

    const line = JSON.stringify(entry);

    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}
