export function nowIso(): string {
  return new Date().toISOString();
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "unknown";
}
