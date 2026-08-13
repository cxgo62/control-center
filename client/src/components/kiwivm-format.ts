const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

export function formatTrafficBytes(bytes: number): string {
  if (bytes >= TiB) return `${(bytes / TiB).toFixed(2)} TiB`;
  return `${(bytes / GiB).toFixed(2)} GiB`;
}

export function formatUsagePercent(percent: number): string {
  return `${percent.toFixed(2)}%`;
}

export function formatShanghaiResetTime(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(
    formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]),
  );

  return [
    `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
    `${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`,
    'Asia/Shanghai',
  ].join(' ');
}
