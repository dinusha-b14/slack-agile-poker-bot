export function nowIso(): string {
  return new Date().toISOString();
}

export function epochSecondsFromNow(minutes: number): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function tableName(): string {
  return requireEnv('SCRUM_POKER_TABLE_NAME');
}
