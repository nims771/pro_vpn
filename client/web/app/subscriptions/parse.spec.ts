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
  decodeProfileTitle,
  formatBytes,
  parseSubscriptionBody,
  parseUserInfo,
} from './parse';

const SS1 =
  'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz@185.22.104.17:443#%F0%9F%87%A9%F0%9F%87%AA%20Germany';
const SS2 = 'ss://YWVzLTI1Ni1nY206c2VjcmV0@nl.example.com:8388#Netherlands';
const VLESS = 'vless://uuid@1.2.3.4:443?security=reality#Reality';
const UNKNOWN = 'tuic://uuid:pass@1.2.3.4:443#Tuic';

function b64(s: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

describe('parseSubscriptionBody', () => {
  it('parses a base64 list and skips unsupported protocols', () => {
    const result = parseSubscriptionBody(
      b64([SS1, VLESS, UNKNOWN, SS2].join('\n'))
    );
    expect(result.entries.map(e => e.name)).toEqual([
      '🇩🇪 Germany',
      'Reality',
      'Netherlands',
    ]);
    expect(result.entries[0].accessKey).toBe(SS1);
    expect(result.entries[1].accessKey).toBe(VLESS);
    expect(result.skipped).toBe(1);
  });

  it('reads VMess names and addresses', () => {
    const vmess =
      'vmess://' +
      b64(JSON.stringify({ps: 'VM 🇫🇮', add: 'vm.example.com', port: 443}));
    const result = parseSubscriptionBody(vmess);
    expect(result.entries[0].name).toBe('VM 🇫🇮');
  });

  it('parses url-safe base64 without padding', () => {
    const body = b64(SS2 + '\n')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(parseSubscriptionBody(body).entries.length).toBe(1);
  });

  it('parses a plain-text list and drops duplicates', () => {
    const result = parseSubscriptionBody(`${SS1}\r\n${SS1}\n\n${SS2}\n`);
    expect(result.entries.length).toBe(2);
  });

  it('parses SIP008 JSON', () => {
    const result = parseSubscriptionBody(
      JSON.stringify({
        version: 1,
        servers: [
          {
            server: '1.2.3.4',
            server_port: 8388,
            password: 'p@ss',
            method: 'chacha20-ietf-poly1305',
            remarks: 'Tokyo',
          },
          {
            server: 'x',
            server_port: 1,
            password: 'a',
            method: 'b',
            plugin: 'obfs',
          },
        ],
      })
    );
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].name).toBe('Tokyo');
    expect(result.entries[0].accessKey).toMatch(
      /^ss:\/\/[\w-]+@1\.2\.3\.4:8388#Tokyo$/
    );
    expect(result.skipped).toBe(1);
  });

  it('returns nothing for unrelated content', () => {
    expect(parseSubscriptionBody('<html>hello</html>').entries).toEqual([]);
    expect(parseSubscriptionBody('').entries).toEqual([]);
  });
});

describe('parseUserInfo', () => {
  it('parses the panel header', () => {
    expect(
      parseUserInfo(
        'upload=1073741824; download=5368709120; total=107374182400; expire=1767225600'
      )
    ).toEqual({
      upload: 1073741824,
      download: 5368709120,
      total: 107374182400,
      expire: 1767225600,
    });
  });

  it('handles unlimited and missing header', () => {
    expect(
      parseUserInfo('upload=0; download=10; total=0; expire=0')?.total
    ).toBe(0);
    expect(parseUserInfo('')).toBeUndefined();
    expect(parseUserInfo('garbage')).toBeUndefined();
  });
});

describe('decodeProfileTitle', () => {
  it('decodes base64 titles', () => {
    expect(decodeProfileTitle('base64:' + b64('Мой VPN'))).toBe('Мой VPN');
    expect(decodeProfileTitle('Plain')).toBe('Plain');
    expect(decodeProfileTitle(undefined)).toBeUndefined();
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5368709120, 'en')).toBe('5 GB');
    expect(formatBytes(150 * 1024 * 1024, 'ru')).toBe('150 МБ');
  });
});
