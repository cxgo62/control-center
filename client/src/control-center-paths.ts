export const CONTROL_CENTER_BASE_PATH = '/control-center/';

export function apiPath(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${CONTROL_CENTER_BASE_PATH}api${suffix}`;
}

export function stripControlCenterBase(path: string): string {
  const prefix = CONTROL_CENTER_BASE_PATH.slice(0, -1);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
