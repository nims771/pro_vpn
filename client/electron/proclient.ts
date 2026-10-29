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

// Fork: desktop counterparts of the Android-only features (speed counters,
// connection test, device id), exposed to the renderer over IPC.

import {execFile} from 'child_process';
import * as http from 'http';
import * as os from 'os';

import {ipcMain} from 'electron';

import {invokeGoMethod} from './go_plugin';

// ---- Traffic counters, reported by tun2socks on stdout ----

let traffic = {rxBytes: 0, txBytes: 0};
const STATS_LINE = /PROVPN_STATS (\d+) (\d+)/g;

/** Feeds tun2socks stdout; keeps the latest "PROVPN_STATS rx tx" values. */
export function parseTrafficStats(data?: string | Buffer) {
  if (!data) return;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  const text = data.toString();
  STATS_LINE.lastIndex = 0;
  while ((match = STATS_LINE.exec(text))) last = match;
  if (last) {
    traffic = {rxBytes: Number(last[1]), txBytes: Number(last[2])};
  }
}

// ---- Subscription refresh and pings outside the VPN ----

let bypassAdapter = '';

/**
 * Tells the Go backend which physical adapter to use for subscription
 * downloads and pings while the VPN is up ('' when it is down), so a blocked
 * server can still be replaced from the panel.
 */
export function setBypassAdapter(index?: string) {
  const value = index && Number(index) > 0 ? String(index) : '';
  if (value === bypassAdapter) return;
  bypassAdapter = value;
  invokeGoMethod('SetBypassInterface', value).catch(e =>
    console.warn(`could not set the bypass adapter: ${e}`)
  );
}

// ---- Connection test: an HTTP request through the VPN ----

const TEST_URLS = [
  'http://cp.cloudflare.com/generate_204',
  'http://connectivitycheck.gstatic.com/generate_204',
];

function timedRequest(url: string, timeoutMs: number): Promise<number> {
  return new Promise(resolve => {
    const start = Date.now();
    const req = http.get(url, {timeout: timeoutMs}, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ? Date.now() - start : -1));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(-1);
    });
    req.on('error', () => resolve(-1));
  });
}

/** Milliseconds of an HTTP request (the system routes it through the VPN). */
async function measureLatency(): Promise<number> {
  for (const url of TEST_URLS) {
    const ms = await timedRequest(url, 5000);
    if (ms >= 0) return Math.max(1, ms);
  }
  return -1;
}

// ---- Device identity (HWID) ----

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      {timeout: timeoutMs, windowsHide: true},
      (error, stdout) => resolve(error ? '' : stdout.toString())
    );
  });
}

let deviceInfo: Promise<object> | undefined;

async function loadDeviceInfo() {
  let deviceId = '';
  let manufacturer = '';
  let model = '';
  let osVersion = os.release();
  if (os.platform() === 'win32') {
    // MachineGuid: unique per Windows installation, survives app reinstalls.
    const reg = await run('reg', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
    ]);
    deviceId = reg.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i)?.[1] ?? '';
    const cim = await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$c = Get-CimInstance Win32_ComputerSystem; $c.Manufacturer + '|' + $c.Model",
    ]);
    [manufacturer = '', model = ''] = cim.trim().split('|');
    // Windows 11 still reports 10.0; builds 22000+ are Windows 11.
    const build = Number(os.release().split('.')[2] ?? 0);
    osVersion = `${build >= 22000 ? '11' : '10'} (${build})`;
  } else if (os.platform() === 'linux') {
    deviceId = (await run('cat', ['/etc/machine-id'])).trim();
  }
  return {
    deviceId: deviceId || os.hostname(),
    manufacturer: manufacturer.trim(),
    model: model.trim() || os.hostname(),
    os: os.platform() === 'win32' ? 'Windows' : os.type(),
    osVersion,
  };
}

/** Registers the IPC handlers the renderer uses (see main.electron.ts). */
export function registerProclientIpc() {
  ipcMain.handle('outline-ipc-proclient-traffic', () => traffic);
  ipcMain.handle('outline-ipc-proclient-latency', () => measureLatency());
  ipcMain.handle('outline-ipc-proclient-device-info', () => {
    deviceInfo ??= loadDeviceInfo();
    return deviceInfo;
  });
}
