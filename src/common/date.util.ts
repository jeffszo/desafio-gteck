// Normaliza uma data (string "YYYY-MM-DD", ou qualquer variante ISO que o
// class-validator @IsDateString aceite) pra meia-noite UTC do mesmo dia
// civil. Sem isso, "2026-07-11" pode virar 07-10 ou 07-12 dependendo do
// timezone configurado no processo Node -- e como localDate/utcDate
// entram na chave de idempotência da ingestão e na contagem de dias do
// relatório/reconciliação, um bug de fronteira de dia aqui é silencioso e
// só aparece quando o ambiente muda.
export function toUtcDateOnly(value: string): Date {
  const datePart = value.slice(0, 10);
  return new Date(`${datePart}T00:00:00.000Z`);
}

export function formatUtcDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Lista todo dia entre from e to (inclusive), como "YYYY-MM-DD".
// Usado pelo relatório (pra saber quais dias iterar por site) e pela
// reconciliação (pra saber quais dias verificar por fonte).
export function enumerateDays(from: string, to: string): string[] {
  const start = toUtcDateOnly(from).getTime();
  const end = toUtcDateOnly(to).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const days: string[] = [];
  for (let t = start; t <= end; t += oneDayMs) {
    days.push(formatUtcDateOnly(new Date(t)));
  }
  return days;
}
