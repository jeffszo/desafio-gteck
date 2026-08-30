
export function toUtcDateOnly(value: string): Date {
  const datePart = value.slice(0, 10);
  return new Date(`${datePart}T00:00:00.000Z`);
}

export function formatUtcDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}


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
