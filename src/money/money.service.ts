import { Injectable } from "@nestjs/common";
import type { MoneyInput, MoneyResult } from "./money.types";

@Injectable()
export class MoneyService {
  // Siga a ordem de operações do README ("Módulo de dinheiro"): revShare,
  // tributo sobre receita, câmbio, tributo sobre custo de mídia, nessa
  // ordem (inverter a ordem muda o resultado). Use a representação
  // numérica que quiser durante o cálculo (number, Decimal, Value Object,
  // outra lib), justifique no DECISIONS.md.
  public calculate(input: MoneyInput): MoneyResult {
    throw new Error("not implemented");
  }
}
