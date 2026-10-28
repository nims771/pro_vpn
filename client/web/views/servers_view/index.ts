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
import {ServerListItem as _ServerListItem} from './server_list_item';
import {pingServer, pingServers} from '../../app/subscriptions/ping';
import {proclientStore} from '../../app/subscriptions/store';

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
      .connect-bar {
        bottom: 0;
        margin-top: auto;
        padding-top: 12px;
        position: sticky;
        z-index: 2;
      }

      /* Fork: "Servers · 3" + ping button above the list. */
      .list-toolbar {
        align-items: center;
        box-sizing: border-box;
        display: flex;
        justify-content: space-between;
        padding: 10px 12px 2px 16px;
      }

      .list-title {
        color: var(--outline-label-color);
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .ping-button {
        align-items: center;
        background: rgba(var(--outline-primary-rgb), 0.1);
        border-radius: 99px;
        color: var(--outline-primary);
        cursor: pointer;
        display: inline-flex;
        flex-direction: row;
        font-size: 0.8rem;
        font-weight: 600;
        gap: 4px;
        padding: 5px 12px 5px 8px;
      }

      .ping-button md-icon {
        --md-icon-size: 18px;
        font-size: 18px;
      }

      .ping-button[disabled] {
        opacity: 0.6;
      }

      .ping-button[disabled] md-icon {
        animation: spin 1s linear infinite;
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
    this.removeEventListener('ProclientSelectServer', this.onSelectServer);
    this.removeEventListener('ProclientPingServer', this.onPingServer);
    this.unsubscribeStore?.();
  }

  // Ping automatically whenever the set of servers changes (app start,
  // subscription added or refreshed).
  updated() {
    // Test the connection once, automatically, right after connecting.
    const active = this.activeServer;
    if (
      active?.connectionState === ServerConnectionState.CONNECTED &&
      this.autoTestedFor !== active.id
    ) {
      this.autoTestedFor = active.id;
      void this.runTest();
    } else if (!active) {
      this.autoTestedFor = '';
    }

    const ids = (this.servers ?? []).map(s => s.id).join(',');
    if (ids && ids !== this.lastPingedIds) {
      this.lastPingedIds = ids;
      window.clearTimeout(this.pingTimer);
      this.pingTimer = window.setTimeout(() => this.runPing(), 800);
    }
  }

  private runPing() {
    if (proclientStore.pinging) return;
    void pingServers(
      (this.servers ?? []).map(s => ({id: s.id, address: s.address}))
    );
  }

  /** The server that is connected (or connecting), if any. */
  private get activeServer(): ServerListItem | undefined {
    return this.servers?.find(s =>
      ServerList.ACTIVE_STATES.includes(s.connectionState)
    );
  }

  /** The server the bottom button acts on. */
  private get targetServer(): ServerListItem | undefined {
    return (
      this.activeServer ??
      this.servers?.find(s => s.id === this.chosenServerId) ??
      this.servers?.[0]
    );
  }

  private onSelectServer = (event: Event) => {
    const serverId = (event as CustomEvent).detail?.serverId;
    if (!serverId) return;
    this.chosenServerId = serverId;
    writeChosenServer(serverId);

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
    if (active) {
      if (active.connectionState !== ServerConnectionState.DISCONNECTING) {
        this.fireServerEvent('DisconnectPressed', active.id);
      }
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
    if (server) void pingServer({id: server.id, address: server.address});
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
    const name = withFlag(target.name);
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

  private renderConnectBar() {
    const target = this.targetServer;
    if (!target) return '';
    const [primary, secondary] = this.statusTexts(target);
    return html`
      <div class="connect-bar">
        <connect-bar
          connection-state=${target.connectionState}
          server-id=${target.id}
          primary=${primary}
          secondary=${secondary}
          ?testing=${this.test?.running ?? false}
          ?disabled=${!this.activeServer && Boolean(target.errorMessageId)}
          @connect-toggle=${this.onConnectButton}
          @status-tap=${() => {
            void this.runTest();
          }}
        ></connect-bar>
      </div>
    `;
  }

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
              <server-connection-indicator
                connection-state="disconnected"
                ?darkMode=${this.darkMode}
              ></server-connection-indicator>
              <h1>${this.localize('server-add')}</h1>
              <h2>${this.localize('server-add-zero-state-instructions')}</h2>
            </button>
          </header>
          <footer>${this.zeroStateContent}</footer>
        </section>
      `;
    } else {
      return html`
        <proclient-panel
          .servers=${this.servers}
          .localize=${this.localize}
        ></proclient-panel>
        <div class="list-toolbar">
          <span class="list-title"
            >${this.localize('proclient-servers-title')} ·
            ${this.servers.length}</span
          >
          <button
            class="ping-button"
            ?disabled=${proclientStore.pinging}
            @click=${() => this.runPing()}
          >
            <md-icon>${proclientStore.pinging ? 'autorenew' : 'speed'}</md-icon>
            ${this.localize('proclient-ping-button')}
          </button>
        </div>
        <server-list
          ?darkMode=${this.darkMode}
          .servers=${this.servers}
          .localize=${this.localize}
          .selectedId=${this.targetServer?.id ?? ''}
          .pings=${proclientStore.pings}
          ?pinging=${proclientStore.pinging}
          .pingingIds=${new Set(proclientStore.pingingIds)}
        ></server-list>
        ${this.renderConnectBar()}
      `;
    }
  }
}

const CHOSEN_SERVER_KEY = 'proclient.chosenServer';

function readChosenServer(): string {
  try {
    return localStorage.getItem(CHOSEN_SERVER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeChosenServer(serverId: string) {
  try {
    localStorage.setItem(CHOSEN_SERVER_KEY, serverId);
  } catch {
    // ignore
  }
}

/** Servers whose name has no country flag get a globe instead. */
function withFlag(name: string): string {
  return /^\s*[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name) ? name : `🌐 ${name}`;
}
