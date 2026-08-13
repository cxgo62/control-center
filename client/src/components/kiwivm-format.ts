const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

export function formatTrafficBytes(bytes: number): string {
  if (bytes >= TiB) return `${(bytes / TiB).toFixed(2)} TiB`;
  return `${(bytes / GiB).toFixed(2)} GiB`;
}

export function formatUsagePercent(percent: number): string {
  const rounded = Number(percent.toFixed(2));
  const crossedThreshold = [70, 85, 95].find(
    threshold => percent < threshold && rounded >= threshold,
  );
  if (crossedThreshold !== undefined) {
    for (let digits = 3; digits <= 15; digits += 1) {
      if (Number(percent.toFixed(digits)) < crossedThreshold) {
        return `${percent.toFixed(digits)}%`;
      }
    }
  }
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
