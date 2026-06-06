import os from 'os';

/** 获取当前局域网 IPv4 地址（取第一个非 127.x 的内网地址） */
export function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const info of iface ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return 'localhost';
}

/** 将字符串中的 {LAN_IP} 替换为当前局域网 IP */
export function resolveIp(s: string): string;
export function resolveIp(s: string | undefined): string | undefined;
export function resolveIp(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.replace(/\{LAN_IP\}/g, getLanIp());
}
