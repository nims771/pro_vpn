/*
  Copyright 2020 The Outline Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import '@material/mwc-button';

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {DirectiveResult} from 'lit/directive';
import {unsafeHTML, UnsafeHTMLDirective} from 'lit/directives/unsafe-html.js';

import {ServerConnectionState as _ServerConnectionState} from './server_connection_indicator';
import './server_connection_indicator';
import './server_list';
import './proclient_panel';
import './server_list_item/proclient_ui';
import './vpn_home';
import {ServerListItem as _ServerListItem} from './server_list_item';
import {whenIntroDone} from '../../app/intro';
import {getSettings} from '../../app/proclient_settings';
import {pingServer, pingServers} from '../../app/subscriptions/ping';
import {proclientStore} from '../../app/subscriptions/store';
import autoLogo from '../../assets/intro-logo.png';

export type ServerListItem = _ServerListItem;

// (This value is used: it's exported.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
export import ServerConnectionState = _ServerConnectionState;

@customElement('servers-view')
export class ServerList extends LitElement {
  @property({type: Boolean}) darkMode = false;

  static styles = [
    css`
      :host {
        /* Stretched by app-root's page area to the space below the header. */
        display: flex;
        flex-direction: column;
        font-size: 0.9rem;
        line-height: 1.25rem;
        margin: 0 auto;
        max-width: 400px;
        width: 100%;
      }
      :host a {
        color: var(--outline-primary);
        text-decoration: none;
      }
      section {
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      header {
        display: flex;
        flex-direction: column;
        flex: 1;
        justify-content: center;
        line-height: 32px;
        text-align: center;
      }
      h1,
      h2,
      footer {
        color: var(--outline-label-color);
        margin: 0;
      }
      h1 {
        color: var(--outline-text-color);
        font-size: 1.25rem;
        font-weight: 400;
      }
      h2 {
        color: var(--outline-text-color);
        font-size: 0.9rem;
        font-weight: initial;
        line-height: 1.5;
      }
      footer {
        border-top: 1px solid var(--outline-hairline);
        color: var(--outline-text-color);
        padding: 24px 0 max(16px, env(safe-area-inset-bottom));
        text-align: center;
      }
      /* Moved from global CSS - specific styling for zero state footer */
      section footer {
        color: var(--outline-text-color);
      }
      section footer a {
        color: var(--outline-primary);
      }
      button {
        align-items: center;
        background-color: transparent;
        border: 0;
        color: var(--outline-text-color);
        display: flex;
        flex-direction: column;
        justify-content: center;
        outline: none; /* Remove outline for Safari. */
        padding: 0;
      }
      button:hover {
        cursor: pointer;
      }
      server-connection-indicator {
        height: 192px;
        margin-bottom: 34px;
        width: 192px;
      }

      /* Fork: the single connect button pinned to the bottom of the page. */
      .zero-logo {
        margin-bottom: 34px;
        max-width: 72%;
        width: 260px;
      }

      /* Fork: "Auto" (best server) choice, first in the list. */
      .auto-card {
        align-items: center;
        background: var(--outline-card-background);
        border: 2px solid transparent;
        border-radius: 14px;
        box-shadow: var(--outline-elevation);
        box-sizing: border-box;
        cursor: pointer;
        display: flex;
        font-family: var(--outline-font-family);
        gap: 10px;
        margin: 4px 8px 6px;
        padding: 9px 12px;
        transition:
          border-color 0.25s ease,
          background 0.25s ease;
      }

      .auto-card.selected {
        background: linear-gradient(
            rgba(var(--outline-primary-rgb), 0.07),
            rgba(var(--outline-primary-rgb), 0.07)
          ),
          var(--outline-card-background);
        border-color: var(--outline-primary);
      }

      .auto-radio {
        border: 2px solid var(--outline-label-color);
        border-radius: 50%;
        box-sizing: border-box;
        display: grid;
        flex: none;
        height: 18px;
        place-items: center;
        width: 18px;
      }

      .auto-radio::after {
        background: var(--outline-primary);
        border-radius: 50%;
        content: '';
        height: 8px;
        transform: scale(0);
        transition: transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1);
        width: 8px;
      }

      .auto-card.selected .auto-radio {
        border-color: var(--outline-primary);
      }

      .auto-card.selected .auto-radio::after {
        transform: scale(1);
      }

      .auto-icon {
        align-items: center;
        background: linear-gradient(
          135deg,
          var(--outline-primary),
          var(--outline-primary-dark, var(--outline-primary))
        );
        border-radius: 8px;
        color: #fff;
        display: flex;
        flex: none;
        height: 26px;
        justify-content: center;
        width: 26px;
        --md-icon-size: 18px;
      }

      .auto-text {
        flex: 1;
        min-width: 0;
      }

      .auto-title {
        color: var(--outline-text-color);
        font-size: 0.95rem;
      }

      .auto-sub {
        color: var(--outline-label-color);
        font-size: 0.72rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .connect-bar {
        bottom: 0;
        margin-top: auto;
        padding-top: 12px;
        position: sticky;
        z-index: 2;
      }

      /* Fork: a subscription (header + its servers), kept apart from others. */
      .group {
        background: rgba(var(--outline-primary-rgb), 0.06);
        border: 1px solid rgba(var(--outline-primary-rgb), 0.16);
        border-radius: 18px;
        display: block;
        flex: none;
        margin: 4px 8px 10px;
        padding: 6px;
      }

      .group proclient-subscription {
        display: block;
      }

      server-list.in-group {
        padding: 6px 0 0;
      }

      .group.manual {
        background: transparent;
        border-color: var(--outline-hairline, rgba(0, 0, 0, 0.1));
      }

      .group-label {
        align-items: center;
        display: flex;
        gap: 2px;
        padding: 2px 2px 2px 6px;
      }

      .group-toggle {
        align-items: center;
        color: var(--outline-label-color);
        flex: 1;
        flex-direction: row;
        font-family: var(--outline-font-family);
        font-size: 0.8rem;
        font-weight: 600;
        gap: 8px;
        justify-content: flex-start;
        letter-spacing: 0.03em;
        min-width: 0;
        padding: 6px 0;
        text-transform: uppercase;
      }

      .group-toggle md-icon,
      .icon-button md-icon {
        --md-icon-size: 20px;
        font-size: 20px;
      }

      .icon-button {
        border-radius: 50%;
        color: var(--outline-label-color);
        flex: none;
        height: 32px;
        width: 32px;
      }

      .icon-button:hover {
        background: rgba(var(--outline-primary-rgb), 0.08);
      }

      .icon-button.spin md-icon {
        animation: spin 0.9s linear infinite;
      }

      .icon-button.chevron md-icon {
        transition: transform 0.25s ease;
      }

      .icon-button.chevron.closed md-icon {
        transform: rotate(-90deg);
      }

      .groups {
        padding-top: 6px;
      }

      .group .auto-card {
        margin: 6px 0 0;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  // Fork: which server the bottom button connects to (persisted).
  @state() private chosenServerId = readChosenServer();

  private static readonly ACTIVE_STATES = [
    ServerConnectionState.CONNECTING,
    ServerConnectionState.CONNECTED,
    ServerConnectionState.RECONNECTING,
    ServerConnectionState.DISCONNECTING,
  ];

  /** Result of the last tap-to-test, shown on the left of the bottom bar. */
  @state() private test?: {
    serverId: string;
    kind: 'http' | 'ping';
    running: boolean;
    ms?: number | null;
  };
  private autoTestedFor = '';

  // Fork: "Auto" = connect to the best server by ping; if it fails, try the
  // next one. The same chain is used to switch away from a server that stops
  // answering (failover).
  private static readonly AUTO = 'auto';
  @state() private chain?: {
    queue: string[];
    current: string;
    sawConnecting: boolean;
  };
  @state() private searching = false;
  private reconnectingSince = new Map<string, number>();
  private static readonly FAILOVER_AFTER_MS = 20_000;
  // Fork: at most one "ask the panel for a new address" per server per minute.
  private static readonly RECOVERY_INTERVAL_MS = 60_000;
  private lastRecoveryAt = new Map<string, number>();
  @state() private recovering = false;
  private launchHandled = false;

  private unsubscribeStore?: () => void;
  private lastPingedIds = '';
  private pingTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('ProclientSelectServer', this.onSelectServer);
    this.addEventListener('ProclientPingServer', this.onPingServer);
    this.unsubscribeStore = proclientStore.subscribe(() =>
      this.requestUpdate()
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.healthTimer);
    this.healthFor = '';
    this.removeEventListener('ProclientSelectServer', this.onSelectServer);
    this.removeEventListener('ProclientPingServer', this.onPingServer);
    this.unsubscribeStore?.();
  }

  // Ping automatically whenever the set of servers changes (app start,
  // subscription added or refreshed).
  updated() {
    const settings = getSettings();
    // Test the connection once, automatically, right after connecting.
    const active = this.activeServer;
    if (
      active?.connectionState === ServerConnectionState.CONNECTED &&
      this.autoTestedFor !== active.id
    ) {
      this.autoTestedFor = active.id;
      if (settings.testAfterConnect) void this.runTest();
    } else if (!active) {
      this.autoTestedFor = '';
    }

    // Live speed counters run while a tunnel is up.
    proclientStore.setVpnActive(
      (this.servers ?? []).some(
        s =>
          s.connectionState === ServerConnectionState.CONNECTED ||
          s.connectionState === ServerConnectionState.RECONNECTING
      )
    );
    this.advanceChain();
    this.updateHealthMonitor();
    this.checkFailover();
    this.maybeConnectOnLaunch();

    const ids = (this.servers ?? []).map(s => s.id).join(',');
    if (ids && ids !== this.lastPingedIds) {
      const first = !this.lastPingedIds;
      this.lastPingedIds = ids;
      // On open only if enabled; after a subscription change always.
      if (!first || settings.pingOnOpen) {
        window.clearTimeout(this.pingTimer);
        this.pingTimer = window.setTimeout(() => this.runPing(), 800);
      }
    }
  }

  // ---- Groups: one per subscription (newest first), then manual servers ----

  /** Group ids in display order. */
  private get groupIds(): string[] {
    const servers = this.servers ?? [];
    const ids = proclientStore.subscriptions.map(s => s.id);
    if (servers.some(s => this.groupOf(s) === MANUAL_GROUP)) {
      ids.push(MANUAL_GROUP);
    }
    return ids;
  }

  private groupOf(server: ServerListItem): string {
    const id = server.subscriptionId;
    return id && proclientStore.subscriptions.some(s => s.id === id)
      ? id
      : MANUAL_GROUP;
  }

  private serversIn(groupId: string): ServerListItem[] {
    return (this.servers ?? []).filter(s => this.groupOf(s) === groupId);
  }

  private get isAuto(): boolean {
    return this.chosenServerId.startsWith(ServerList.AUTO);
  }

  /**
   * The group whose "Auto" is chosen ("auto:<group>"); the old plain "auto"
   * and a group that no longer exists mean the first one.
   */
  private get autoGroup(): string | undefined {
    if (!this.isAuto) return undefined;
    const ids = this.groupIds;
    const wanted = this.chosenServerId.slice(ServerList.AUTO.length + 1);
    return ids.includes(wanted) ? wanted : ids[0];
  }

  /** Servers sorted best-first by ping; unmeasured after, unreachable last. */
  private rankedServers(
    exclude: string[] = [],
    groupId?: string
  ): ServerListItem[] {
    const pings = proclientStore.pings;
    const score = (s: ServerListItem) => {
      const ms = pings[s.id];
      if (typeof ms === 'number') return ms;
      return ms === null ? 1e9 : 1e6;
    };
    const pool = groupId ? this.serversIn(groupId) : (this.servers ?? []);
    return pool
      .filter(s => !exclude.includes(s.id) && !s.errorMessageId)
      .sort((a, b) => score(a) - score(b));
  }

  private bestServerIn(groupId?: string): ServerListItem | undefined {
    return this.rankedServers([], groupId)[0];
  }

  /**
   * Pings the group (fresh), then connects to its best server, falling back
   * down the list. Without a group: the group of the chosen "Auto".
   */
  private async startChain(exclude: string[] = [], groupId = this.autoGroup) {
    if (this.searching) return;
    this.searching = true;
    const pool = groupId ? this.serversIn(groupId) : (this.servers ?? []);
    try {
      await pingServers(pingTargets(pool));
    } finally {
      this.searching = false;
    }
    const pings = proclientStore.pings;
    let ranked = this.rankedServers(exclude, groupId);
    // Prefer servers that answered; keep the rest only as a last resort.
    const reachable = ranked.filter(s => pings[s.id] !== null);
    if (reachable.length) ranked = reachable;
    const [first, ...rest] = ranked.map(s => s.id);
    if (!first) return;
    this.chain = {queue: rest, current: first, sawConnecting: false};
    this.fireServerEvent('ConnectPressed', first);
  }

  private advanceChain() {
    const chain = this.chain;
    if (!chain) return;
    const current = this.servers?.find(s => s.id === chain.current);
    if (!current) {
      this.chain = undefined;
      return;
    }
    const state = current.connectionState;
    if (state === ServerConnectionState.CONNECTED) {
      this.chain = undefined;
    } else if (
      state === ServerConnectionState.CONNECTING ||
      state === ServerConnectionState.RECONNECTING
    ) {
      if (!chain.sawConnecting) this.chain = {...chain, sawConnecting: true};
    } else if (
      state === ServerConnectionState.DISCONNECTED &&
      chain.sawConnecting
    ) {
      // That one failed: try the next best.
      proclientStore.markUnreachable(chain.current);
      const [next, ...rest] = chain.queue;
      if (!next) {
        this.chain = undefined;
        return;
      }
      this.chain = {queue: rest, current: next, sawConnecting: false};
      this.fireServerEvent('ConnectPressed', next);
    }
  }

  /**
   * A server that has been "reconnecting" for too long (Android) or stopped
   * answering (health check elsewhere): first ask its panel whether it moved
   * to a new address (outside the VPN), then switch to the next best server.
   */
  private checkFailover() {
    const now = Date.now();
    for (const s of this.servers ?? []) {
      if (s.connectionState !== ServerConnectionState.RECONNECTING) {
        this.reconnectingSince.delete(s.id);
      } else if (!this.reconnectingSince.has(s.id)) {
        this.reconnectingSince.set(s.id, now);
        // Re-check once the grace period is over.
        window.setTimeout(
          () => this.requestUpdate(),
          ServerList.FAILOVER_AFTER_MS + 500
        );
      }
    }
    const active = this.activeServer;
    if (!active || this.chain || this.searching || this.recovering) return;
    const since = this.reconnectingSince.get(active.id);
    const stuck =
      active.connectionState === ServerConnectionState.RECONNECTING &&
      since !== undefined &&
      now - since >= ServerList.FAILOVER_AFTER_MS;
    const dead =
      this.unhealthyId === active.id &&
      active.connectionState === ServerConnectionState.CONNECTED;
    if (!stuck && !dead) return;
    const last = this.lastRecoveryAt.get(active.id) ?? 0;
    if (now - last < ServerList.RECOVERY_INTERVAL_MS) return;
    this.lastRecoveryAt.set(active.id, now);
    this.reconnectingSince.delete(active.id);
    this.unhealthyId = undefined;
    void this.recoverOrFailover(active.id);
  }

  private async recoverOrFailover(serverId: string) {
    this.recovering = true;
    let replacement: string | undefined;
    try {
      replacement = await new Promise<string | undefined>(resolve => {
        this.dispatchEvent(
          new CustomEvent('ProclientRecoverServer', {
            detail: {serverId, done: resolve},
            bubbles: true,
            composed: true,
          })
        );
        // Nobody listening (tests, previews): carry on.
        window.setTimeout(() => resolve(undefined), 45_000);
      });
    } finally {
      this.recovering = false;
    }
    if (replacement) {
      if (this.chosenServerId === serverId) {
        this.chosenServerId = replacement;
        writeChosenServer(replacement);
      }
      return;
    }
    const active = this.activeServer;
    if (!getSettings().failover || active?.id !== serverId) return;
    // Next best server of the same subscription (or of the chosen "Auto").
    const group = this.autoGroup ?? this.groupOf(active);
    if (this.serversIn(group).length >= 2) {
      void this.startChain([serverId], group);
    }
  }

  // ---- Health check (platforms without a native watchdog, e.g. Windows) ----

  private static readonly HEALTH_INTERVAL_MS = 20_000;
  private static readonly HEALTH_RECHECK_MS = 5_000;
  private healthFor = '';
  private healthTimer?: number;
  private unhealthyId?: string;

  private updateHealthMonitor() {
    const active = this.activeServer;
    const watch =
      !proclientStore.nativeWatchdog &&
      proclientStore.canMeasureLatency &&
      active?.connectionState === ServerConnectionState.CONNECTED
        ? active.id
        : '';
    if (watch === this.healthFor) return;
    window.clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
    this.healthFor = watch;
    this.unhealthyId = undefined;
    if (watch) this.scheduleHealthCheck(ServerList.HEALTH_INTERVAL_MS, 0);
  }

  private scheduleHealthCheck(delay: number, failures: number) {
    window.clearTimeout(this.healthTimer);
    this.healthTimer = window.setTimeout(async () => {
      const id = this.healthFor;
      if (!id) return;
      const ms = await proclientStore.measureLatency();
      if (id !== this.healthFor) return;
      if (ms === undefined || ms >= 0) {
        this.scheduleHealthCheck(ServerList.HEALTH_INTERVAL_MS, 0);
        return;
      }
      if (failures + 1 < 2) {
        this.scheduleHealthCheck(ServerList.HEALTH_RECHECK_MS, failures + 1);
        return;
      }
      console.warn(`server ${id} stopped answering`);
      this.unhealthyId = id;
      this.requestUpdate();
      // Keep watching: if it comes back, nothing else happens.
      this.scheduleHealthCheck(ServerList.HEALTH_INTERVAL_MS, 0);
    }, delay);
  }

  /** "Connect on launch" setting: once, after the app has settled. */
  private maybeConnectOnLaunch() {
    if (this.launchHandled || !(this.servers?.length ?? 0)) return;
    this.launchHandled = true;
    if (!getSettings().connectOnLaunch) return;
    void whenIntroDone().then(() =>
      window.setTimeout(() => {
        if (!this.activeServer) this.onConnectButton();
      }, 1500)
    );
  }

  private runPing() {
    if (proclientStore.pinging) return;
    void pingServers(pingTargets(this.servers ?? []));
  }

  /** The server that is connected (or connecting), if any. */
  private get activeServer(): ServerListItem | undefined {
    return this.servers?.find(s =>
      ServerList.ACTIVE_STATES.includes(s.connectionState)
    );
  }

  /** The server the bottom button acts on. */
  private get targetServer(): ServerListItem | undefined {
    if (this.activeServer) return this.activeServer;
    if (this.isAuto) {
      const group = this.autoGroup;
      return (
        this.bestServerIn(group) ??
        (group ? this.serversIn(group)[0] : undefined) ??
        this.servers?.[0]
      );
    }
    return (
      this.servers?.find(s => s.id === this.chosenServerId) ?? this.servers?.[0]
    );
  }

  private onSelectServer = (event: Event) => {
    const serverId = (event as CustomEvent).detail?.serverId;
    if (!serverId) return;
    this.chosenServerId = serverId;
    writeChosenServer(serverId);
    this.chain = undefined;
    this.backToVpnSoon();
    if (serverId.startsWith(ServerList.AUTO)) return;

    // Already connected to another server: switch to the chosen one.
    const active = this.activeServer;
    // Connected, still connecting or reconnecting to another server (for
    // example one that doesn't answer): switch to the chosen one right away.
    if (
      active &&
      active.id !== serverId &&
      active.connectionState !== ServerConnectionState.DISCONNECTING
    ) {
      this.fireServerEvent('ConnectPressed', serverId);
    }
  };

  private onConnectButton() {
    const active = this.activeServer;
    this.chain = undefined;
    if (active) {
      if (active.connectionState !== ServerConnectionState.DISCONNECTING) {
        this.fireServerEvent('DisconnectPressed', active.id);
      }
      return;
    }
    if (this.isAuto) {
      void this.startChain();
      return;
    }
    const target = this.targetServer;
    if (target && !target.errorMessageId) {
      this.fireServerEvent('ConnectPressed', target.id);
    }
  }

  private fireServerEvent(type: string, serverId: string) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: {serverId},
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Tap on a card's ping: measure that server again. */
  private onPingServer = (event: Event) => {
    const serverId = (event as CustomEvent).detail?.serverId;
    const server = this.servers?.find(s => s.id === serverId);
    if (server && isPingable(server)) {
      void pingServer({id: server.id, address: server.address});
    }
  };

  /**
   * Tap on the bottom bar's status: while connected, time a real HTTP request
   * through the server; otherwise ping the chosen server.
   */
  private async runTest() {
    const target = this.targetServer;
    if (!target || this.test?.running) return;
    const connected =
      target.connectionState === ServerConnectionState.CONNECTED ||
      target.connectionState === ServerConnectionState.RECONNECTING;
    const kind = connected ? 'http' : 'ping';
    this.test = {serverId: target.id, kind, running: true};
    let ms: number | null | undefined;
    if (kind === 'http') {
      const result = await proclientStore.measureLatency();
      ms = result === undefined ? undefined : result >= 0 ? result : null;
    } else {
      ms = await pingServer({id: target.id, address: target.address});
    }
    this.test = {serverId: target.id, kind, running: false, ms};
  }

  private statusTexts(target: ServerListItem): [string, string] {
    const state = target.connectionState;
    const name = this.isAuto
      ? this.localize('proclient-auto-via', 'name', withFlag(target.name))
      : withFlag(target.name);
    if (this.searching) {
      return [this.localize('proclient-auto-searching'), name];
    }
    if (this.recovering) {
      return [this.localize('proclient-recovering'), name];
    }
    const test = this.test?.serverId === target.id ? this.test : undefined;
    const up =
      state === ServerConnectionState.CONNECTED ||
      state === ServerConnectionState.RECONNECTING;

    if (state === ServerConnectionState.CONNECTING) {
      return [this.localize('connecting-server-state'), name];
    }
    if (state === ServerConnectionState.DISCONNECTING) {
      return [this.localize('disconnecting-server-state'), name];
    }
    if (state === ServerConnectionState.RECONNECTING) {
      return [this.localize('reconnecting-server-state'), name];
    }
    if (test?.running) {
      return [this.localize('proclient-test-running'), name];
    }
    if (up) {
      if (test?.kind === 'http' && test.ms !== undefined) {
        return [
          test.ms === null
            ? this.localize('proclient-test-fail')
            : this.localize('proclient-test-ok', 'ms', String(test.ms)),
          name,
        ];
      }
      return [this.localize('proclient-test-tap-connected'), name];
    }
    if (test?.kind === 'ping' && test.ms !== undefined) {
      return [
        test.ms === null
          ? this.localize('proclient-ping-fail')
          : this.localize('proclient-ping-result', 'ms', String(test.ms)),
        name,
      ];
    }
    return [this.localize('proclient-ping-tap'), name];
  }

  private renderAutoCard(groupId: string) {
    const selected = this.isAuto && this.autoGroup === groupId;
    const best = this.bestServerIn(groupId);
    const ms = best ? proclientStore.pings[best.id] : undefined;
    const sub = best
      ? this.localize('proclient-auto-best', 'name', withFlag(best.name)) +
        (typeof ms === 'number'
          ? ` · ${this.localize('proclient-ms', 'ms', String(ms))}`
          : '')
      : this.localize('proclient-auto-desc');
    return html`<div
      class="auto-card ${selected ? 'selected' : ''}"
      role="radio"
      aria-checked=${selected ? 'true' : 'false'}
      tabindex="0"
      @click=${() => this.selectAuto(groupId)}
      @keydown=${(e: KeyboardEvent) =>
        (e.key === 'Enter' || e.key === ' ') && this.selectAuto(groupId)}
    >
      <span class="auto-radio"></span>
      <span class="auto-icon"><md-icon>bolt</md-icon></span>
      <div class="auto-text">
        <div class="auto-title">${this.localize('proclient-auto')}</div>
        <div class="auto-sub">${sub}</div>
      </div>
    </div>`;
  }

  private renderServerList(servers: ServerListItem[], inGroup: boolean) {
    return html`<server-list
      class=${inGroup ? 'in-group' : ''}
      ?darkMode=${this.darkMode}
      .servers=${servers}
      .localize=${this.localize}
      .selectedId=${this.isAuto ? '' : (this.targetServer?.id ?? '')}
      .pings=${proclientStore.pings}
      .pingingIds=${new Set(proclientStore.pingingIds)}
    ></server-list>`;
  }

  /**
   * Fork: one block per subscription (newest first) with its own "Auto", its
   * quota, ping button and servers, which can be collapsed; servers added by
   * hand come last.
   */
  private renderGroups() {
    const active = this.activeServer;
    return this.groupIds.map(groupId => {
      const members = this.serversIn(groupId);
      const collapsed = this.collapsedGroups.has(groupId);
      const pinging = this.isGroupPinging(groupId);
      const body =
        collapsed || !members.length
          ? ''
          : html`${this.renderAutoCard(groupId)}
            ${this.renderServerList(members, true)}`;
      if (groupId === MANUAL_GROUP) {
        return html`<section class="group manual">
          <div class="group-label">
            <button
              class="group-toggle"
              aria-expanded=${collapsed ? 'false' : 'true'}
              @click=${() => this.toggleGroup(MANUAL_GROUP)}
            >
              <md-icon>dns</md-icon>
              <span
                >${this.localize('proclient-my-servers')} ·
                ${members.length}</span
              >
            </button>
            <button
              class="icon-button ${pinging ? 'spin' : ''}"
              title=${this.localize('proclient-ping-button')}
              ?disabled=${pinging}
              @click=${() => this.pingGroup(MANUAL_GROUP)}
            >
              <md-icon>speed</md-icon>
            </button>
            <button
              class="icon-button chevron ${collapsed ? 'closed' : ''}"
              title=${this.localize(
                collapsed
                  ? 'proclient-subscription-expand'
                  : 'proclient-subscription-collapse'
              )}
              @click=${() => this.toggleGroup(MANUAL_GROUP)}
            >
              <md-icon>expand_more</md-icon>
            </button>
          </div>
          ${body}
        </section>`;
      }
      const sub = proclientStore.subscriptions.find(s => s.id === groupId);
      const activeHere = !!active && this.groupOf(active) === groupId;
      return html`<section class="group">
        <proclient-subscription
          .localize=${this.localize}
          .subscription=${sub}
          ?collapsed=${collapsed}
          ?pinging=${pinging}
          .activeName=${activeHere ? withFlag(active!.name) : ''}
          @toggle-collapse=${() => this.toggleGroup(groupId)}
          @ping-group=${() => this.pingGroup(groupId)}
        ></proclient-subscription>
        ${body}
      </section>`;
    });
  }

  @state() private collapsedGroups = readCollapsedGroups();

  private toggleGroup(id: string) {
    const next = new Set(this.collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedGroups = next;
    writeCollapsedGroups(next);
  }

  private selectAuto(groupId: string) {
    const id = `${ServerList.AUTO}:${groupId}`;
    const active = this.activeServer;
    this.chosenServerId = id;
    writeChosenServer(id);
    this.chain = undefined;
    this.backToVpnSoon();
    // Connected through another subscription: move to this one's best.
    if (
      active &&
      active.connectionState !== ServerConnectionState.DISCONNECTING &&
      this.groupOf(active) !== groupId
    ) {
      void this.startChain([], groupId);
    }
  }

  /** After picking a server in "Profiles", show it on the "VPN" tab. */
  private backToVpnSoon() {
    if (this.tab !== 'profiles') return;
    window.setTimeout(() => this.requestTab('vpn'), 260);
  }

  private pingGroup(groupId: string) {
    void pingServers(pingTargets(this.serversIn(groupId)));
  }

  private isGroupPinging(groupId: string): boolean {
    return this.serversIn(groupId).some(s =>
      proclientStore.pingingIds.has(s.id)
    );
  }

  /** Fork: the "VPN" tab (big power button, server, account, speed). */
  private renderVpnHome() {
    const target = this.targetServer;
    const groupId = target ? this.groupOf(target) : undefined;
    const subscription =
      groupId && groupId !== MANUAL_GROUP
        ? proclientStore.subscriptions.find(s => s.id === groupId)
        : undefined;
    const details = target
      ? [
          target.protocol || 'Shadowsocks',
          subscription?.title || this.localize('proclient-my-servers'),
        ].join(' · ')
      : '';
    return html`<vpn-home
      .localize=${this.localize}
      .server=${target}
      location=${target ? this.statusTexts(target)[1] : ''}
      details=${details}
      note=${target ? this.noteText(target) : ''}
      ?busy=${(this.test?.running ?? false) ||
      this.searching ||
      this.recovering}
      ?disabled=${!target ||
      (!this.activeServer && Boolean(target.errorMessageId))}
      .subscription=${subscription}
      .traffic=${proclientStore.traffic}
      @power-toggle=${this.onConnectButton}
      @open-profiles=${() => this.requestTab('profiles')}
      @status-tap=${() => {
        void this.runTest();
      }}
    ></vpn-home>`;
  }

  /** The hint / test result under the timer (not the state, shown above). */
  private noteText(target: ServerListItem): string {
    const state = target.connectionState;
    if (
      !this.searching &&
      !this.recovering &&
      (state === ServerConnectionState.CONNECTING ||
        state === ServerConnectionState.DISCONNECTING ||
        state === ServerConnectionState.RECONNECTING)
    ) {
      return '';
    }
    return this.statusTexts(target)[0];
  }

  /** Asks app-root to show the "VPN" or "Profiles" tab. */
  private requestTab(tab: 'vpn' | 'profiles') {
    this.dispatchEvent(
      new CustomEvent('ProclientHomeTab', {
        detail: {tab},
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Fork: which tab of the home page is shown ("vpn" or "profiles"). */
  @property({type: String}) tab = 'vpn';

  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: Boolean}) shouldShowAccessKeyWikiLink = false;
  @property({type: Array}) servers: ServerListItem[] = [];

  get shouldShowZeroState() {
    return this.servers ? this.servers.length === 0 : false;
  }

  private requestPromptAddServer() {
    this.dispatchEvent(
      new CustomEvent('add-server', {bubbles: true, composed: true})
    );
  }

  private get zeroStateContent(): DirectiveResult<typeof UnsafeHTMLDirective> {
    let msg;
    if (this.shouldShowAccessKeyWikiLink) {
      msg = this.localize(
        'server-create-your-own-zero-state-access',
        'breakLine',
        '<br/>',
        'openLink',
        '<a href=https://s3.amazonaws.com/outline-vpn/get-started/#step-1>',
        'openLink2',
        '<a href=https://www.reddit.com/r/outlinevpn/wiki/index/outline_vpn_access_keys/>',
        'closeLink',
        '</a>'
      );
    } else {
      msg = this.localize(
        'server-create-your-own-zero-state',
        'breakLine',
        '<br/>',
        'openLink',
        '<a href=https://s3.amazonaws.com/outline-vpn/get-started/#step-1>',
        'closeLink',
        '</a>'
      );
    }
    return unsafeHTML(msg);
  }

  render() {
    if (this.shouldShowZeroState) {
      return html`
        <section>
          <header>
            <button type="button" @click=${this.requestPromptAddServer}>
              <img class="zero-logo" src=${autoLogo} alt="" />
              <h1>${this.localize('server-add')}</h1>
              <h2>${this.localize('server-add-zero-state-instructions')}</h2>
            </button>
          </header>
          <footer>${this.zeroStateContent}</footer>
        </section>
      `;
    } else {
      return this.tab === 'profiles'
        ? html`<div class="groups">${this.renderGroups()}</div>`
        : this.renderVpnHome();
    }
  }
}

const COLLAPSED_GROUPS_KEY = 'proclient.collapsedGroups';
const MANUAL_GROUP = 'manual';

function readCollapsedGroups(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || '[]');
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    // ignore
  }
}

const CHOSEN_SERVER_KEY = 'proclient.chosenServer';

function readChosenServer(): string {
  try {
    // "Auto" (best server) by default.
    return localStorage.getItem(CHOSEN_SERVER_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

function writeChosenServer(serverId: string) {
  try {
    localStorage.setItem(CHOSEN_SERVER_KEY, serverId);
  } catch {
    // ignore
  }
}

/**
 * Fork: the ping is a TCP connect, which UDP-only protocols (Hysteria2,
 * WireGuard) don't answer: leave them unmeasured rather than "unreachable".
 */
function isPingable(server: ServerListItem): boolean {
  return server.protocol !== 'Hysteria2' && server.protocol !== 'WireGuard';
}

function pingTargets(servers: ServerListItem[]) {
  return servers.filter(isPingable).map(s => ({id: s.id, address: s.address}));
}

/** Servers whose name has no country flag get a globe instead. */
function withFlag(name: string): string {
  return /^\s*[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name) ? name : `🌐 ${name}`;
}
