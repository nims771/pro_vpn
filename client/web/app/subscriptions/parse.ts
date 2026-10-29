// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  isXrayLink,
  protocolLabel,
  xrayLinkAddress,
  xrayLinkName,
} from '../xray_links';

// Fork: parsing of VPN panel subscriptions (Marzban, 3x-ui, Remnawave, ...).

/** Traffic quota from the "Subscription-Userinfo" header. Bytes / unix seconds. */
/** Fork: devices on the subscription, if the panel reports them. */
export interface DeviceUsage {
  /** Devices registered (by HWID); undefined if unknown. */
  used?: number;
  /** Device limit; 0 means unlimited; undefined if unknown. */
  limit?: number;
  /** The panel refused this device: the limit is reached. */
  limitReached?: boolean;
}

/**
 * Reads device usage from response headers (lower-cased names):
 *  - "x-hwid-devices" / "x-devices": "2/3", "2/∞", "2/0" (0 = no limit) or "2";
 *  - "x-hwid-devices-count" / "x-devices-count" with
 *    "x-hwid-devices-limit" / "x-devices-limit" / "x-device-limit";
 *  - "x-hwid-max-devices-reached" / "x-hwid-limit": "true" (Remnawave).
 */
export function parseDeviceUsage(
  headers?: Record<string, string>
): DeviceUsage | undefined {
  if (!headers) return undefined;
  const get = (...names: string[]) =>
    names.map(n => headers[n]?.trim()).find(v => v);
  const toLimit = (v?: string) => {
    if (!v) return undefined;
    if (/^(∞|inf|infinity|unlimited|-1|0)$/i.test(v)) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const toCount = (v?: string) => {
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const usage: DeviceUsage = {};
  const pair = get('x-hwid-devices', 'x-devices');
  if (pair) {
    const [used, limit] = pair.split('/').map(p => p.trim());
    usage.used = toCount(used);
    usage.limit = toLimit(limit);
  }
  usage.used ??= toCount(get('x-hwid-devices-count', 'x-devices-count'));
  usage.limit ??= toLimit(
    get('x-hwid-devices-limit', 'x-devices-limit', 'x-device-limit')
  );
  if (
    /^true$/i.test(get('x-hwid-max-devices-reached') ?? '') ||
    /^true$/i.test(get('x-hwid-limit') ?? '')
  ) {
    usage.limitReached = true;
  }
  return usage.used !== undefined ||
    usage.limit !== undefined ||
    usage.limitReached
    ? usage
    : undefined;
}

export interface SubscriptionUserInfo {
  upload: number;
  download: number;
  /** 0 means unlimited. */
  total: number;
  /** Unix seconds; 0 means no expiry. */
  expire: number;
}

export interface SubscriptionEntry {
  accessKey: string;
  name: string;
}

export interface ParsedSubscription {
  entries: SubscriptionEntry[];
  /** Links of protocols this app can't use (vless://, vmess://, trojan://...). */
  skipped: number;
}

/** Parses "upload=1; download=2; total=3; expire=4". */
export function parseUserInfo(
  header: string | undefined | null
): SubscriptionUserInfo | undefined {
  if (!header) return undefined;
  const info: SubscriptionUserInfo = {
    upload: 0,
    download: 0,
    total: 0,
    expire: 0,
  };
  let found = false;
  for (const part of header.split(/[;,]/)) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase() as keyof SubscriptionUserInfo;
    const value = Number(rawValue?.trim());
    if (key in info && Number.isFinite(value) && value >= 0) {
      info[key] = value;
      found = true;
    }
  }
  return found ? info : undefined;
}

/** Decodes the "Profile-Title" header, which panels may send as "base64:...". */
export function decodeProfileTitle(
  header: string | undefined | null
): string | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value.toLowerCase().startsWith('base64:')) {
    return decodeBase64Utf8(value.slice('base64:'.length))?.trim() || undefined;
  }
  return value || undefined;
}

/** Turns a panel subscription body into the list of Shadowsocks access keys. */
export function parseSubscriptionBody(body: string): ParsedSubscription {
  const text = (body ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) return {entries: [], skipped: 0};

  if (text.startsWith('{') || text.startsWith('[')) {
    const sip008 = parseSip008(text);
    if (sip008) return sip008;
  }

  let lines = text;
  if (!text.includes('://')) {
    const decoded = decodeBase64Utf8(text);
    if (decoded && decoded.includes('://')) lines = decoded;
  }

  const entries: SubscriptionEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of lines.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^ss:\/\//i.test(line)) {
      const accessKey = 'ss://' + line.slice(5);
      if (seen.has(accessKey)) continue;
      seen.add(accessKey);
      entries.push({accessKey, name: nameFromLink(accessKey)});
    } else if (isXrayLink(line)) {
      // Fork: VLESS, VMess, Trojan, Hysteria2, WireGuard (Xray-core).
      if (seen.has(line)) continue;
      seen.add(line);
      entries.push({
        accessKey: line,
        name:
          xrayLinkName(line) ||
          xrayLinkAddress(line) ||
          protocolLabel(line) ||
          'Server',
      });
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
      skipped++;
    }
  }
  return {entries, skipped};
}

// SIP008: {"version":1,"servers":[{"server","server_port","password","method","remarks"}]}
function parseSip008(text: string): ParsedSubscription | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const servers = Array.isArray(json)
    ? json
    : (json as {servers?: unknown})?.servers;
  if (!Array.isArray(servers)) return undefined;

  const entries: SubscriptionEntry[] = [];
  let skipped = 0;
  for (const s of servers as Array<Record<string, unknown>>) {
    const host = String(s?.server ?? '');
    const port = Number(s?.server_port);
    const method = String(s?.method ?? '');
    const password = String(s?.password ?? '');
    if (!host || !port || !method || s?.plugin) {
      skipped++;
      continue;
    }
    const name = String(s?.remarks ?? '') || host;
    const userInfo = encodeBase64Url(`${method}:${password}`);
    const hostPart = host.includes(':') ? `[${host}]` : host;
    entries.push({
      accessKey: `ss://${userInfo}@${hostPart}:${port}#${encodeURIComponent(name)}`,
      name,
    });
  }
  return {entries, skipped};
}

function nameFromLink(link: string): string {
  const hash = link.indexOf('#');
  if (hash >= 0) {
    const tag = link.slice(hash + 1);
    try {
      const decoded = decodeURIComponent(tag.replace(/\+/g, '%20')).trim();
      if (decoded) return decoded;
    } catch {
      if (tag.trim()) return tag.trim();
    }
  }
  const at = link.lastIndexOf('@');
  const rest = link.slice(at >= 0 ? at + 1 : 5);
  return rest.split(/[/?#]/)[0] || 'Shadowsocks';
}

/** Decodes standard or URL-safe base64, with or without padding, as UTF-8. */
export function decodeBase64Utf8(input: string): string | undefined {
  const cleaned = input
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!cleaned || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return undefined;
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8', {fatal: false}).decode(bytes);
  } catch {
    return undefined;
  }
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Formatting helpers for the UI.

export function formatBytes(bytes: number, lang = 'ru'): string {
  const ru = lang.startsWith('ru');
  const units = ru
    ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
    : ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const number = value.toLocaleString(lang, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${number} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number, lang = 'ru'): string {
  return `${formatBytes(bytesPerSecond, lang)}/${lang.startsWith('ru') ? 'с' : 's'}`;
}
