export function isoUtcTimestamp(now: Date = new Date()): string {
  return `,"time":"${now.toISOString()}"`;
}

export const fastifyLoggerOptions = {
  level: 'info',
  timestamp: isoUtcTimestamp,
};
