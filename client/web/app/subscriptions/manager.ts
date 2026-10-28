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

// Fork: adds, refreshes and removes panel subscriptions.

import uuidv4 from 'uuidv4';

import {
  decodeProfileTitle,
  parseSubscriptionBody,
  parseUserInfo,
  SubscriptionUserInfo,
} from './parse';
import {proclientStore, Subscription} from './store';
import {ServerRepository} from '../../model/server';
import {deviceHeaders} from '../device';
import {getDefaultMethodChannel} from '../method_channel';
import {getSettings} from '../proclient_settings';

const DEFAULT_UPDATE_INTERVAL_HOURS = 6;

interface FetchedSubscription {
  body: string;
  userInfo?: string;
  title?: string;
  updateInterval?: string;
  supportUrl?: string;
  webPageUrl?: string;
}

interface Downloaded {
  entries: Array<{accessKey: string; name: string}>;
  skipped: number;
  userInfo?: SubscriptionUserInfo;
  title?: string;
  updateIntervalHours?: number;
  supportUrl?: string;
  looksLikeSubscription: boolean;
}

export interface SubscriptionOutcome {
  subscription: Subscription;
  added: number;
  removed: number;
  failed: number;
}

export class SubscriptionManager {
  private inFlight = new Map<string, Promise<SubscriptionOutcome>>();

  constructor(
    private repo: ServerRepository,
    private onServersChanged: () => void
  ) {}

  /** Whether the text could be a subscription link (as opposed to ss://). */
  static isCandidateUrl(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text.trim());
  }

  /**
   * Tries to add `url` as a subscription. Returns undefined when the link
   * isn't a subscription (e.g. it's a single dynamic Outline key), so the
   * caller can fall back to the regular flow.
   */
  async tryAdd(url: string): Promise<SubscriptionOutcome | undefined> {
    url = url.trim();
    const existing = proclientStore.subscriptions.find(s => s.url === url);
    if (existing) return this.refresh(existing.id);

    let downloaded: Downloaded;
    try {
      downloaded = await download(url);
    } catch (e) {
      console.warn(`not a subscription (download failed): ${e}`);
      return undefined;
    }
    if (!downloaded.looksLikeSubscription) return undefined;

    const subscription: Subscription = {
      id: uuidv4(),
      url,
      title: downloaded.title || hostOf(url),
      userInfo: downloaded.userInfo,
      supportUrl: downloaded.supportUrl,
      updateIntervalHours: downloaded.updateIntervalHours,
      updatedAt: Date.now(),
      skipped: downloaded.skipped,
    };
    proclientStore.setSubscriptions([
      ...proclientStore.subscriptions,
      subscription,
    ]);
    return this.apply(subscription, downloaded);
  }

  /** Refreshes subscriptions whose interval elapsed (or all, with force). */
  async refreshAll(force = false): Promise<void> {
    const now = Date.now();
    // User setting: -1 = never automatically, N = every N hours, 0 = panel's.
    const setting = getSettings().subscriptionRefreshHours;
    if (!force && setting < 0) return;
    const due = proclientStore.subscriptions.filter(s => {
      if (force || !s.updatedAt) return true;
      const hours =
        setting > 0
          ? setting
          : s.updateIntervalHours || DEFAULT_UPDATE_INTERVAL_HOURS;
      return now - s.updatedAt > hours * 3600_000;
    });
    await Promise.allSettled(due.map(s => this.refresh(s.id)));
  }

  refresh(id: string): Promise<SubscriptionOutcome> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const task = this.doRefresh(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, task);
    return task;
  }

  private async doRefresh(id: string): Promise<SubscriptionOutcome> {
    const subscription = proclientStore.subscriptions.find(s => s.id === id);
    if (!subscription) throw new Error(`unknown subscription ${id}`);
    proclientStore.patchSubscription(id, {refreshing: true});
    try {
      const downloaded = await download(subscription.url);
      const updated: Subscription = {
        ...subscription,
        title: downloaded.title || subscription.title,
        userInfo: downloaded.userInfo ?? subscription.userInfo,
        supportUrl: downloaded.supportUrl ?? subscription.supportUrl,
        updateIntervalHours:
          downloaded.updateIntervalHours ?? subscription.updateIntervalHours,
        updatedAt: Date.now(),
        skipped: downloaded.skipped,
        lastError: undefined,
      };
      return await this.apply(updated, downloaded);
    } catch (e) {
      proclientStore.patchSubscription(id, {
        refreshing: false,
        lastError: String(e?.message || e),
      });
      throw e;
    }
  }

  private async apply(
    subscription: Subscription,
    downloaded: Downloaded
  ): Promise<SubscriptionOutcome> {
    const result = await this.repo.syncSubscription!(
      subscription.id,
      downloaded.entries
    );
    const updated = {...subscription, serverCount: result.total};
    proclientStore.patchSubscription(subscription.id, {
      ...updated,
      refreshing: false,
    });
    this.onServersChanged();
    return {
      subscription: updated,
      added: result.added,
      removed: result.removed,
      failed: result.failed,
    };
  }

  async remove(id: string): Promise<void> {
    await this.repo.forgetSubscription!(id);
    proclientStore.setSubscriptions(
      proclientStore.subscriptions.filter(s => s.id !== id)
    );
    this.onServersChanged();
  }
}

async function download(url: string): Promise<Downloaded> {
  // Panels that limit devices identify this one by these headers.
  let headers: Record<string, string> = {};
  try {
    headers = await deviceHeaders();
  } catch {
    // Send without them.
  }
  const raw = await getDefaultMethodChannel().invokeMethod(
    'FetchSubscription',
    JSON.stringify({url, headers})
  );
  const fetched: FetchedSubscription = JSON.parse(raw);
  const body = fetched.body ?? '';
  const {entries, skipped} = parseSubscriptionBody(body);
  const userInfo = parseUserInfo(fetched.userInfo);
  const hours = Number(fetched.updateInterval);
  const trimmed = body.trim();
  const wasEncoded = !!trimmed && !trimmed.includes('://');
  return {
    entries,
    skipped,
    userInfo,
    title: decodeProfileTitle(fetched.title),
    updateIntervalHours: hours > 0 ? Math.max(1, hours) : undefined,
    supportUrl: fetched.supportUrl || fetched.webPageUrl || undefined,
    // A single plain ss:// line is how dynamic Outline keys answer, so only
    // call it a subscription if it looks like one.
    looksLikeSubscription:
      (entries.length > 0 || skipped > 0) &&
      (entries.length + skipped > 1 || !!userInfo || wasEncoded),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
