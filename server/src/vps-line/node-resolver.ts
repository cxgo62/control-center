import { isIP } from 'node:net';

export type PrivateNodeEndpoint = {
  name: string;
  host: string;
  port: number;
};

export type PrivateNodeResolutionErrorCode =
  | 'PRIVATE_NODE_NAME_INVALID'
  | 'CLASH_PROXIES_INVALID'
  | 'PRIVATE_NODE_NOT_FOUND'
  | 'PRIVATE_NODE_AMBIGUOUS'
  | 'PRIVATE_NODE_INVALID';

export type PrivateNodeResolution =
  | { ok: true; endpoint: PrivateNodeEndpoint }
  | { ok: false; error: { code: PrivateNodeResolutionErrorCode; message: string } };

type RelevantProxyKey = 'name' | 'server' | 'port';

type ProxyEntry = {
  fields: Partial<Record<RelevantProxyKey, string>>;
  malformed: boolean;
};

const NODE_RESOLUTION_MESSAGE = 'Configured private node could not be resolved';

function failure(code: PrivateNodeResolutionErrorCode, message = NODE_RESOLUTION_MESSAGE): PrivateNodeResolution {
  return { ok: false, error: { code, message } };
}

function indentation(line: string): number {
  const prefix = line.match(/^[ \t]*/)?.[0] ?? '';
  return [...prefix].reduce((width, character) => width + (character === '\t' ? 2 : 1), 0);
}

function stripComment(line: string): string {
  let quote: 'single' | 'double' | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === 'double') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = undefined;
      continue;
    }
    if (quote === 'single') {
      if (character === "'" && line[index + 1] === "'") index += 1;
      else if (character === "'") quote = undefined;
      continue;
    }
    if (character === '"') quote = 'double';
    else if (character === "'") quote = 'single';
    else if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function parseScalar(rawValue: string | undefined): string | null {
  if (rawValue === undefined) return null;
  const value = stripComment(rawValue).trim();
  if (!value || value === 'null' || value === '~' || /^[\[{&*!|>]/.test(value)) return null;
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed.trim() : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) return null;
    return value.slice(1, -1).replace(/''/g, "'").trim();
  }
  if (value.includes('"') || value.includes("'")) return null;
  return value;
}

function parseMapping(line: string): [string, string] | null {
  const match = stripComment(line).trim().match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  return match ? [match[1], match[2]] : null;
}

function isRelevantProxyKey(key: string): key is RelevantProxyKey {
  return key === 'name' || key === 'server' || key === 'port';
}

function retainRelevantField(entry: ProxyEntry, mapping: [string, string]): void {
  const [key, value] = mapping;
  if (!isRelevantProxyKey(key)) return;
  if (Object.hasOwn(entry.fields, key)) {
    entry.malformed = true;
    return;
  }
  entry.fields[key] = value;
}

function isSafeProbeHost(host: string): boolean {
  const ipVersion = isIP(host);
  if (ipVersion !== 0) return ipVersion === 4;
  if (host.length > 253 || /^[0-9.]+$/.test(host)) return false;
  return host.split('.').every(label => (
    label.length > 0
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));
}

function parseProxyEntries(content: string): ProxyEntry[] | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const proxiesIndexes = lines.flatMap((line, index) => (
    indentation(line) === 0 && /^proxies\s*:/.test(stripComment(line)) ? [index] : []
  ));
  if (proxiesIndexes.length !== 1) return null;
  const proxiesIndex = proxiesIndexes[0];
  const header = stripComment(lines[proxiesIndex]).match(/^proxies\s*:\s*(.*)$/);
  if (!header) return null;
  const headerValue = header[1].trim();
  if (headerValue === '[]') return [];
  if (headerValue !== '') return null;

  const body: string[] = [];
  for (let index = proxiesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const significant = stripComment(line).trim();
    if (significant && indentation(line) === 0 && !/^-\s+/.test(significant)) break;
    body.push(line);
  }

  const firstContentLine = body.find(line => stripComment(line).trim());
  if (!firstContentLine) return [];
  const itemIndent = indentation(firstContentLine);
  if (!/^\s*-\s+/.test(firstContentLine)) return null;

  const blocks: string[][] = [];
  for (const line of body) {
    const significant = stripComment(line).trim();
    if (!significant) continue;
    if (indentation(line) === itemIndent && /^\s*-\s+/.test(line)) blocks.push([line]);
    else {
      if (!blocks.length || indentation(line) <= itemIndent) return null;
      blocks.at(-1)?.push(line);
    }
  }

  return blocks.map(block => {
    const entry: ProxyEntry = { fields: {}, malformed: false };
    const firstLine = block[0].replace(/^\s*-\s+/, '');
    const firstMapping = parseMapping(firstLine);
    if (!firstMapping) return { ...entry, malformed: true };
    retainRelevantField(entry, firstMapping);

    const mappingLines = block.slice(1)
      .map(line => ({ line, mapping: parseMapping(line), indent: indentation(line) }))
      .filter((candidate): candidate is { line: string; mapping: [string, string]; indent: number } => candidate.mapping !== null);
    const directIndent = mappingLines.reduce<number | null>(
      (minimum, candidate) => minimum === null || candidate.indent < minimum ? candidate.indent : minimum,
      null,
    );
    for (const candidate of mappingLines) {
      if (candidate.indent === directIndent) retainRelevantField(entry, candidate.mapping);
    }
    return entry;
  });
}

export function resolvePrivateNode(content: string, configuredName: string): PrivateNodeResolution {
  const identity = configuredName.trim();
  if (!identity) return failure('PRIVATE_NODE_NAME_INVALID', 'Private node identity is invalid');

  const entries = parseProxyEntries(content);
  if (!entries || entries.some(entry => entry.malformed || !parseScalar(entry.fields.name))) {
    return failure('CLASH_PROXIES_INVALID', 'Clash proxy configuration is invalid');
  }

  const matches = entries.filter(entry => parseScalar(entry.fields.name) === identity);
  if (!matches.length) return failure('PRIVATE_NODE_NOT_FOUND');
  if (matches.length > 1) return failure('PRIVATE_NODE_AMBIGUOUS');

  const host = parseScalar(matches[0].fields.server);
  const portValue = parseScalar(matches[0].fields.port);
  const port = portValue !== null && /^\d+$/.test(portValue) ? Number(portValue) : Number.NaN;
  if (!host || !isSafeProbeHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return failure('PRIVATE_NODE_INVALID');
  }

  return { ok: true, endpoint: { name: identity, host, port } };
}
