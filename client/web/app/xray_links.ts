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

// Fork: share links of the Xray protocols (handled by Xray-core in the
// native backend, see client/go/outline/xraytransport).

const XRAY_SCHEMES = [
  'vless',
  'vmess',
  'trojan',
  'hysteria2',
  'hy2',
  'wireguard',
  'wg',
];

const XRAY_LINK = new RegExp(`^(${XRAY_SCHEMES.join('|')})://`, 'i');

export function isXrayLink(text: string): boolean {
  return XRAY_LINK.test(text.trim());
}

/** Lower-case scheme of a link ("vless"), or "" if it has none. */
export function linkScheme(text: string): string {
  return (
    /^([a-z][a-z0-9+.-]*):\/\//i.exec(text.trim())?.[1].toLowerCase() ?? ''
  );
}

/** Protocol label to show for a link. */
export function protocolLabel(text: string): string {
  switch (linkScheme(text)) {
    case 'vless':
      return 'VLESS';
    case 'vmess':
      return 'VMess';
    case 'trojan':
      return 'Trojan';
    case 'hysteria2':
    case 'hy2':
      return 'Hysteria2';
    case 'wireguard':
    case 'wg':
      return 'WireGuard';
    case 'ss':
      return 'Shadowsocks';
  }
  return '';
}

/** The server's name in a link: the #fragment, or the "ps" of a VMess link. */
export function xrayLinkName(text: string): string | undefined {
  text = text.trim();
  if (/^vmess:\/\//i.test(text) && !text.split('#')[0].includes('@')) {
    const json = decodeVmess(text);
    const ps = typeof json?.ps === 'string' ? json.ps.trim() : '';
    if (ps) return ps;
  }
  const hash = text.indexOf('#');
  if (hash < 0) return undefined;
  const tag = text.slice(hash + 1);
  try {
    return decodeURIComponent(tag.replace(/\+/g, '%20')).trim() || undefined;
  } catch {
    return tag.trim() || undefined;
  }
}

/** The link without its #name (what the backend gets). */
export function stripLinkName(text: string): string {
  return text.trim().split('#')[0];
}

/** "host:port" of the server in a link, if it can be read. */
export function xrayLinkAddress(text: string): string | undefined {
  text = text.trim();
  if (/^vmess:\/\//i.test(text) && !text.split('#')[0].includes('@')) {
    const json = decodeVmess(text);
    if (!json?.add) return undefined;
    return formatHostPort(String(json.add), String(json.port ?? ''));
  }
  const rest = text.replace(/^[a-z0-9+.-]+:\/\//i, '').split(/[#?/]/)[0];
  const authority = rest.slice(rest.lastIndexOf('@') + 1);
  const match =
    /^\[([^\]]+)\]:?([\d,-]*)$/.exec(authority) ??
    /^([^:]+):?([\d,-]*)$/.exec(authority);
  if (!match) return undefined;
  return formatHostPort(match[1], match[2]);
}

function formatHostPort(host: string, portSpec: string): string {
  const port = /\d+/.exec(portSpec)?.[0] ?? '443';
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function decodeVmess(text: string): Record<string, unknown> | undefined {
  const encoded = text.replace(/^vmess:\/\//i, '').split('#')[0];
  try {
    const normalized = encoded
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
