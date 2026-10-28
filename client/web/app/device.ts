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

// Fork: a stable, unique id of this device (HWID), shown in settings and sent
// to subscription panels (x-hwid) so they can limit the number of devices.

export interface DeviceInfo {
  /** Formatted as XXXX-XXXX-XXXX-XXXX. */
  hwid: string;
  manufacturer: string;
  model: string;
  os: string;
  osVersion: string;
}

interface RawDeviceInfo {
  deviceId: string;
  manufacturer: string;
  model: string;
  os: string;
  osVersion: string;
}

const FALLBACK_KEY = 'proclient.hwid';
let source: (() => Promise<RawDeviceInfo>) | undefined;
let cached: Promise<DeviceInfo> | undefined;

/** Called by the platform layer (Android: ANDROID_ID, model, OS). */
export function setDeviceInfoSource(fn: () => Promise<RawDeviceInfo>) {
  source = fn;
  cached = undefined;
}

export function getDeviceInfo(): Promise<DeviceInfo> {
  cached ??= load();
  return cached;
}

async function load(): Promise<DeviceInfo> {
  // UI elements can ask while the bundle is still loading, before the platform
  // layer has registered its source: let the entry script finish first, so
  // every caller sees the same (real) device id.
  await new Promise(resolve => setTimeout(resolve, 0));
  let raw: RawDeviceInfo | undefined;
  try {
    raw = await source?.();
  } catch (e) {
    console.warn(`device info unavailable: ${e}`);
  }
  const seed = raw?.deviceId ? `provpn:${raw.deviceId}` : fallbackSeed();
  return {
    hwid: format(await digest(seed)),
    manufacturer: raw?.manufacturer ?? '',
    model: raw?.model ?? '',
    os: raw?.os || guessOs(),
    osVersion: raw?.osVersion ?? '',
  };
}

/** Random id kept in storage, for platforms without a device id. */
function fallbackSeed(): string {
  try {
    let id = localStorage.getItem(FALLBACK_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
        b.toString(16).padStart(2, '0')
      ).join('');
      localStorage.setItem(FALLBACK_KEY, id);
    }
    return `provpn:random:${id}`;
  } catch {
    return `provpn:random:${Math.random()}`;
  }
}

async function digest(text: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b =>
      b.toString(16).padStart(2, '0')
    ).join('');
  } catch {
    // No WebCrypto (insecure context): simple 64-bit FNV-1a, twice.
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (const ch of text) {
      h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
}

function format(hex: string): string {
  const id = hex.slice(0, 16).toUpperCase();
  return id.match(/.{4}/g)!.join('-');
}

function guessOs(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS';
  return 'Web';
}

/** Headers some panels (e.g. Remnawave) use to count and limit devices. */
export async function deviceHeaders(): Promise<Record<string, string>> {
  const d = await getDeviceInfo();
  return {
    'x-hwid': d.hwid,
    'x-device-os': d.os,
    'x-ver-os': d.osVersion,
    'x-device-model': [d.manufacturer, d.model].filter(Boolean).join(' '),
  };
}
