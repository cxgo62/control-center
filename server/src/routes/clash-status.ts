export type ClashStatus =
  | {
      available: true;
      mixedPort: number;
      mode: string;
      tunEnabled: boolean;
      tunStack: string;
    }
  | {
      available: false;
      error: {
        code: 'CLASH_CONFIG_UNAVAILABLE';
        message: string;
      };
    };

export const unavailableClashStatus: ClashStatus = {
  available: false,
  error: {
    code: 'CLASH_CONFIG_UNAVAILABLE',
    message: 'Clash Verge 配置不可用',
  },
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseClashVergeConfig(content: string): ClashStatus {
  const portMatch = content.match(/^mixed-port:\s*(\d+)\s*(?:#.*)?$/m);
  const modeMatch = content.match(/^mode:\s*([^\n#]*?)(?:\s+#.*)?$/m);
  const tunMatch = content.match(/^tun:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)/m);

  if (!portMatch || !modeMatch || !tunMatch) return unavailableClashStatus;

  const mixedPort = Number(portMatch[1]);
  const mode = unquote(modeMatch[1]);
  const enableMatch = tunMatch[1].match(/^\s+enable:\s*(true|false)\s*(?:#.*)?$/m);
  const stackMatch = tunMatch[1].match(/^\s+stack:\s*([^\n#]*?)(?:\s+#.*)?$/m);
  const tunStack = stackMatch ? unquote(stackMatch[1]) : '';

  if (
    !Number.isInteger(mixedPort)
    || mixedPort < 1
    || mixedPort > 65535
    || mode.length === 0
    || !enableMatch
    || tunStack.length === 0
  ) {
    return unavailableClashStatus;
  }

  return {
    available: true,
    mixedPort,
    mode,
    tunEnabled: enableMatch[1] === 'true',
    tunStack,
  };
}
