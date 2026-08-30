import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma-client";

interface ErrorBody {
  statusCode: number;
  message: string;
}

// Rede de segurança pra qualquer coisa que escape dos services: sem isso,
// um erro do Prisma (ex.: violação de constraint que passou batido) ou
// qualquer exceção não tratada vira um 500 cru do Express, sem log
// nenhum e sem corpo consistente pra quem chamou a API. Com o filtro,
// toda exceção passa por um lugar só, vira uma resposta JSON previsível e
// fica registrada no logger (estruturado, ver JsonLoggerService) com
// método/rota e stack trace.
//
// Erros de validação de DTO (class-validator) e afins continuam saindo
// como HttpException normal -- esse filtro não muda esse caminho, só
// captura tudo que não era esperado.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const { status, body } = this.toHttpResponse(exception);

    const logMessage = `${request?.method ?? "?"} ${request?.url ?? "?"} -> ${status}: ${body.message}`;
    const stack = exception instanceof Error ? exception.stack : undefined;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logMessage, stack);
    } else {
      this.logger.warn(logMessage);
    }

    response.status(status).json(body);
  }

  private toHttpResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const rawMessage =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: unknown }).message ?? exception.message);
      const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : String(rawMessage);

      return { status, body: { statusCode: status, message } };
    }

    // Erro conhecido do Prisma (violação de constraint, registro não
    // encontrado, etc.) -- não é bug de programação, é conflito de dado.
    // Trata como 409 em vez de deixar virar 500 genérico.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return {
        status: HttpStatus.CONFLICT,
        body: {
          statusCode: HttpStatus.CONFLICT,
          message: `Conflito ao acessar os dados (Prisma ${exception.code}).`,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Erro interno inesperado." },
    };
  }
}
