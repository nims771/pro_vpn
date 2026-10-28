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

// Fork: shared state behind the top panel (subscription quota + live traffic).
// The app writes it, the panel reads it; both live in the same bundle.

import type {SubscriptionUserInfo} from './parse';

export interface Subscription {
  id: string;
  url: string;
  title?: string;
  userInfo?: SubscriptionUserInfo;
  supportUrl?: string;
  /** How often to refresh, in hours (from the panel, default 6). */
  updateIntervalHours?: number;
  /** Unix ms of the last successful refresh. */
  updatedAt?: number;
  serverCount?: number;
  /** Unsupported links the panel offered (vless://, etc). */
  skipped?: number;
  lastError?: string;
}

export interface SubscriptionView extends Subscription {
  refreshing?: boolean;
}

export interface TrafficView {
  /** Whether the platform can report traffic at all. */
  available: boolean;
  downBps: number;
  upBps: number;
  sessionDown: number;
  sessionUp: number;
}

export interface TrafficCounters {
  rxBytes: number;
  txBytes: number;
}

const STORAGE_KEY = 'proclient.subscriptions';
const TRAFFIC_BASE_KEY = 'proclient.trafficBase';

type Listener = () => void;

class ProclientStore {
  subscriptions: SubscriptionView[] = [];
  traffic: TrafficView = {
    available: false,
    downBps: 0,
    upBps: 0,
    sessionDown: 0,
    sessionUp: 0,
  };

  private listeners = new Set<Listener>();
  private trafficSource?: () => Promise<TrafficCounters>;
  private trafficTimer?: number;
  private lastSample?: {at: number; rx: number; tx: number};
  private vpnActive = false;

  constructor() {
    this.subscriptions = loadSubscriptions();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  // ---- subscriptions ----

  setSubscriptions(list: SubscriptionView[]) {
    this.subscriptions = list;
    saveSubscriptions(list);
    this.emit();
  }

  patchSubscription(id: string, patch: Partial<SubscriptionView>) {
    this.setSubscriptions(
      this.subscriptions.map(s => (s.id === id ? {...s, ...patch} : s))
    );
  }

  // ---- ping ----

  /** Latency per server id in ms; null = unreachable; absent = not measured. */
  pings: Record<string, number | null> = {};
  pinging = false;
  private pingRun = 0;

  /** Measures all given servers (id + "host:port"); ignores empty addresses. */
  async pingServers(
    servers: Array<{id: string; address: string}>,
    measure: (addresses: string[]) => Promise<Record<string, number>>
  ): Promise<void> {
    const targets = servers.filter(s => s.address);
    if (!targets.length) return;
    const run = ++this.pingRun;
    this.pinging = true;
    this.emit();
    try {
      const results = await measure(targets.map(s => s.address));
      if (run !== this.pingRun) return;
      const pings = {...this.pings};
      for (const s of targets) {
        const ms = results[s.address];
        pings[s.id] = typeof ms === 'number' && ms >= 0 ? ms : null;
      }
      this.pings = pings;
    } catch (e) {
      console.warn(`ping failed: ${e}`);
    } finally {
      if (run === this.pingRun) {
        this.pinging = false;
        this.emit();
      }
    }
  }

  // ---- traffic ----

  /** Called by the platform layer when it can count tunnel bytes. */
  setTrafficSource(source: () => Promise<TrafficCounters>) {
    this.trafficSource = source;
    this.traffic = {...this.traffic, available: true};
    this.updatePolling();
    this.emit();
  }

  /** Called by the UI whenever the set of connected servers changes. */
  setVpnActive(active: boolean) {
    if (active === this.vpnActive) return;
    this.vpnActive = active;
    if (!active) {
      writeBase(undefined);
      this.lastSample = undefined;
      this.traffic = {
        ...this.traffic,
        downBps: 0,
        upBps: 0,
        sessionDown: 0,
        sessionUp: 0,
      };
      this.emit();
    }
    this.updatePolling();
  }

  private updatePolling() {
    const shouldPoll = this.vpnActive && !!this.trafficSource;
    if (shouldPoll && this.trafficTimer === undefined) {
      void this.sampleTraffic();
      this.trafficTimer = window.setInterval(() => {
        void this.sampleTraffic();
      }, 1000);
    } else if (!shouldPoll && this.trafficTimer !== undefined) {
      window.clearInterval(this.trafficTimer);
      this.trafficTimer = undefined;
    }
  }

  private async sampleTraffic() {
    if (!this.trafficSource) return;
    let counters: TrafficCounters;
    try {
      counters = await this.trafficSource();
    } catch {
      return; // Service not ready yet; try again next tick.
    }
    const now = Date.now();
    const rx = Number(counters.rxBytes) || 0;
    const tx = Number(counters.txBytes) || 0;

    // Session baseline survives app restarts; reset if the VPN process
    // restarted (its counters start from zero again).
    let base = readBase();
    if (!base || rx < base.rx || tx < base.tx) {
      base = {rx, tx};
      writeBase(base);
    }

    let downBps = 0;
    let upBps = 0;
    const last = this.lastSample;
    if (last && now > last.at && rx >= last.rx && tx >= last.tx) {
      const seconds = (now - last.at) / 1000;
      downBps = (rx - last.rx) / seconds;
      upBps = (tx - last.tx) / seconds;
    }
    this.lastSample = {at: now, rx, tx};

    if (!this.vpnActive) return;
    this.traffic = {
      available: true,
      downBps,
      upBps,
      sessionDown: rx - base.rx,
      sessionUp: tx - base.tx,
    };
    this.emit();
  }
}

function loadSubscriptions(): SubscriptionView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveSubscriptions(list: SubscriptionView[]) {
  try {
    // Don't persist transient UI flags.
    const clean = list.map(({refreshing: _refreshing, ...rest}) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Storage full or unavailable: keep in memory.
  }
}

function readBase(): {rx: number; tx: number} | undefined {
  try {
    const raw = localStorage.getItem(TRAFFIC_BASE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeBase(base: {rx: number; tx: number} | undefined) {
  try {
    if (base) {
      localStorage.setItem(TRAFFIC_BASE_KEY, JSON.stringify(base));
    } else {
      localStorage.removeItem(TRAFFIC_BASE_KEY);
    }
  } catch {
    // ignore
  }
}

export const proclientStore = new ProclientStore();
