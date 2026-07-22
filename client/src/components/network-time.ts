function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatSamplingTime(timestamp: number | null, now = new Date()): string | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;

  const sampledAt = new Date(timestamp);
  if (Number.isNaN(sampledAt.getTime())) return null;

  const time = `${pad(sampledAt.getHours())}:${pad(sampledAt.getMinutes())}:${pad(sampledAt.getSeconds())}`;
  const sameDay = sampledAt.getFullYear() === now.getFullYear()
    && sampledAt.getMonth() === now.getMonth()
    && sampledAt.getDate() === now.getDate();

  if (sameDay) return `采样时间 · 今天 ${time}`;

  return `采样时间 · ${sampledAt.getFullYear()}-${pad(sampledAt.getMonth() + 1)}-${pad(sampledAt.getDate())} ${time}`;
}
