import type { NetBucket } from '../types.js';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateTime(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function time(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function bucketIndexAtOffset(offsetX: number, width: number, count: number): number {
  if (width <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(offsetX / width * count)));
}

export function cardHoverPosition(offsetX: number, cardWidth: number, inset: number, count: number): { index: number; x: number } {
  const contentStart = inset;
  const contentEnd = Math.max(contentStart, cardWidth - inset);
  const x = Math.min(contentEnd, Math.max(contentStart, offsetX));
  return { index: bucketIndexAtOffset(x - contentStart, contentEnd - contentStart, count), x };
}

export function formatBucketTooltip(bucket: NetBucket, _now = new Date()): string | null {
  if (!Number.isFinite(bucket.startAt) || !Number.isFinite(bucket.endAt)) return null;
  const start = new Date(bucket.startAt);
  const end = new Date(bucket.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  const interval = sameDay ? `${time(start)}–${time(end)}` : `${dateTime(start)}–${dateTime(end)}`;
  const state = !bucket.hasData ? '无数据' : bucket.up ? '正常' : '断线';
  return `${interval} · ${state}`;
}
