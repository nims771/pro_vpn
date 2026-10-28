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

// Fork: user settings of the VPN app (stored on the device).

export interface ProclientSettings {
  /** Connect (to Auto or the chosen server) when the app is opened. */
  connectOnLaunch: boolean;
  /** If the server stops answering for a while, switch to the next best one. */
  failover: boolean;
  /** Test the connection through the server right after connecting. */
  testAfterConnect: boolean;
  /** Ping all servers when the app opens. */
  pingOnOpen: boolean;
  /** Subscription refresh: 0 = panel's interval, -1 = never, else hours. */
  subscriptionRefreshHours: number;
}

const DEFAULTS: ProclientSettings = {
  connectOnLaunch: false,
  failover: true,
  testAfterConnect: true,
  pingOnOpen: true,
  subscriptionRefreshHours: 0,
};

const KEY = 'proclient.settings';
type Listener = (settings: ProclientSettings) => void;
const listeners = new Set<Listener>();

let current: ProclientSettings = load();

function load(): ProclientSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return {...DEFAULTS, ...(raw ? JSON.parse(raw) : {})};
  } catch {
    return {...DEFAULTS};
  }
}

export function getSettings(): ProclientSettings {
  return current;
}

export function updateSettings(patch: Partial<ProclientSettings>) {
  current = {...current, ...patch};
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Keep in memory.
  }
  for (const listener of listeners) listener(current);
}

export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- Android system VPN settings (always-on VPN, block without VPN) ----

let openSystemVpnSettings: (() => Promise<void>) | undefined;

/** Called by the platform layer when it can open the system VPN screen. */
export function setSystemVpnSettingsOpener(fn: () => Promise<void>) {
  openSystemVpnSettings = fn;
}

export function canOpenSystemVpnSettings(): boolean {
  return !!openSystemVpnSettings;
}

export async function openSystemVpnSettingsScreen(): Promise<void> {
  await openSystemVpnSettings?.();
}
