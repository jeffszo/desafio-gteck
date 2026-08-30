import { describe, expect, it, vi } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function buildHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: "GET", url: "/reports" };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe("AllExceptionsFilter", () => {
  it("preserva status e mensagem de uma HttpException conhecida", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    filter.catch(new BadRequestException("from inválido"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "from inválido",
    });
  });

  it("junta mensagens em array (ex.: class-validator) numa string só", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    filter.catch(new BadRequestException(["from é obrigatório", "to é obrigatório"]), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "from é obrigatório, to é obrigatório",
    });
  });

  it("trata erro conhecido do Prisma como 409, não 500", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "Conflito ao acessar os dados (Prisma P2002).",
    });
  });

  it("qualquer outra coisa (erro de programação) vira 500 genérico, sem vazar detalhe interno", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    filter.catch(new Error("undefined is not a function"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Erro interno inesperado.",
    });
  });
});
