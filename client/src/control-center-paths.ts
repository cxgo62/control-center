export const CONTROL_CENTER_BASE_PATH = '/control-center/';

export function apiPath(
  path: string,
  basePath = CONTROL_CENTER_BASE_PATH,
): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}api${suffix}`;
}

export function stripBasePath(path: string, basePath: string): string {
  const prefix = basePath.slice(0, -1);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function stripControlCenterBase(path: string): string {
  return stripBasePath(path, CONTROL_CENTER_BASE_PATH);
}
