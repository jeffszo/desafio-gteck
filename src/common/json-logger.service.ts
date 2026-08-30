import type { LoggerService } from "@nestjs/common";

// Logger estruturado: cada chamada de log vira uma linha JSON em vez de
// texto colorido pra terminal. É o que faz sentido pra observabilidade de
// verdade -- em produção esse output vai pra um coletor de log (Datadog,
// CloudWatch, etc.), e ferramentas assim leem JSON, não a formatação
// bonitinha que o ConsoleLogger padrão do Nest imprime.
//
// app.useLogger(new JsonLoggerService()) no main.ts troca o logger de toda
// a aplicação de uma vez só: como o Nest usa uma referência estática
// compartilhada por trás de cada `new Logger(contexto)`, os logs que já
// existiam em IngestionService e ReportsService passam a sair em JSON sem
// precisar mexer nesses arquivos.
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
