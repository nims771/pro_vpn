/*
  Copyright 2026 The Outline Authors
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

// Fork: the "VPN" tab — big round power button, status, timer, the chosen
// server, the subscription account (traffic, expiry) and live speed.

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import {ServerConnectionState} from './server_connection_indicator';
import {ServerListItem} from './server_list_item';
import './server_list_item/proclient_ui';
import {formatBytes, formatSpeed} from '../../app/subscriptions/parse';
import {SubscriptionView, TrafficView} from '../../app/subscriptions/store';

const DAY_MS = 24 * 3600 * 1000;

@customElement('vpn-home')
export class VpnHome extends LitElement {
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({attribute: false}) server?: ServerListItem;
  /** "Auto · 🇩🇪 Germany" or "🇩🇪 Germany". */
  @property({type: String}) location = '';
  /** Protocol / subscription under the server name. */
  @property({type: String}) details = '';
  /** Small hint or test result under the timer. */
  @property({type: String}) note = '';
  @property({type: Boolean}) busy = false;
  @property({type: Boolean}) disabled = false;
  @property({attribute: false}) subscription?: SubscriptionView;
  @property({attribute: false}) traffic?: TrafficView;

  static styles = css`
    :host {
      box-sizing: border-box;
      color: var(--outline-text-color);
      display: flex;
      flex-direction: column;
      font-family: var(--outline-font-family);
      gap: 12px;
      margin: 0 auto;
      max-width: 520px;
      padding: 18px 14px 20px;
      width: 100%;
      --glow: rgba(var(--outline-primary-rgb), 0.45);
    }

    /* ---- Power button ---- */
    .hero {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 18px 0 4px;
    }

    .power {
      -webkit-tap-highlight-color: transparent;
      background: none;
      border: 0;
      cursor: pointer;
      display: grid;
      height: 172px;
      margin: 22px 0 18px;
      padding: 0;
      place-items: center;
      position: relative;
      width: 172px;
    }

    .power:disabled {
      cursor: default;
      opacity: 0.6;
    }

    /* Two soft rings around the button. */
    .ring {
      border-radius: 50%;
      inset: -26px;
      position: absolute;
      transition:
        background 0.4s ease,
        box-shadow 0.4s ease;
      background: radial-gradient(
        circle,
        rgba(var(--outline-primary-rgb), 0.1) 55%,
        rgba(var(--outline-primary-rgb), 0.05) 56%,
        rgba(var(--outline-primary-rgb), 0.05) 77%,
        transparent 78%
      );
    }

    :host([state='disconnected']) .ring {
      background: radial-gradient(
        circle,
        rgba(127, 127, 127, 0.1) 55%,
        rgba(127, 127, 127, 0.05) 56%,
        rgba(127, 127, 127, 0.05) 77%,
        transparent 78%
      );
    }

    /* Spinning arc while connecting. */
    .arc {
      border-radius: 50%;
      inset: -8px;
      opacity: 0;
      position: absolute;
      transition: opacity 0.3s ease;
      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        var(--outline-primary) 90deg,
        transparent 91deg
      );
      -webkit-mask: radial-gradient(
        farthest-side,
        transparent calc(100% - 4px),
        #000 calc(100% - 3px)
      );
      mask: radial-gradient(
        farthest-side,
        transparent calc(100% - 4px),
        #000 calc(100% - 3px)
      );
    }

    :host([state='connecting']) .arc,
    :host([state='reconnecting']) .arc,
    :host([state='disconnecting']) .arc {
      animation: spin 1.1s linear infinite;
      opacity: 1;
    }

    /* A small satellite circling the button while connected. */
    .orbit {
      animation: spin 9s linear infinite;
      inset: -26px;
      opacity: 0;
      position: absolute;
      transition: opacity 0.4s ease;
    }

    .orbit::after {
      background: var(--outline-label-color);
      border: 3px solid var(--outline-background);
      border-radius: 50%;
      content: '';
      height: 12px;
      left: 24px;
      position: absolute;
      top: 24px;
      width: 12px;
    }

    :host([state='connected']) .orbit {
      opacity: 0.9;
    }

    .core {
      align-items: center;
      background: var(--outline-card-background);
      border: 2px solid rgba(var(--outline-primary-rgb), 0.45);
      border-radius: 50%;
      box-shadow: var(--outline-elevation);
      box-sizing: border-box;
      color: var(--outline-primary);
      display: flex;
      flex-direction: column;
      gap: 4px;
      height: 100%;
      justify-content: center;
      position: relative;
      transition:
        background 0.4s ease,
        box-shadow 0.4s ease,
        color 0.3s ease,
        transform 0.15s ease;
      width: 100%;
    }

    .power:active .core {
      transform: scale(0.96);
    }

    :host([state='connected']) .core {
      background: radial-gradient(
        circle at 50% 30%,
        color-mix(in srgb, var(--outline-primary) 70%, #fff),
        var(--outline-primary) 70%
      );
      border-color: transparent;
      box-shadow:
        0 0 46px var(--glow),
        0 10px 30px rgba(0, 0, 0, 0.25);
      color: #fff;
    }

    .core md-icon {
      --md-icon-size: 64px;
      font-size: 64px;
    }

    .core .label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .status {
      color: var(--outline-label-color);
      font-size: 1.55rem;
      font-weight: 700;
      line-height: 1.2;
      text-align: center;
    }

    :host([state='connected']) .status {
      color: var(--outline-primary);
    }

    .location {
      color: var(--outline-label-color);
      font-size: 0.86rem;
      max-width: 100%;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .timer {
      background: rgba(var(--outline-primary-rgb), 0.14);
      border-radius: 99px;
      color: var(--outline-primary);
      font-family: 'Roboto Mono', ui-monospace, monospace;
      font-size: 0.95rem;
      font-weight: 600;
      margin-top: 6px;
      padding: 6px 16px;
    }

    .note {
      background: none;
      border: 0;
      color: var(--outline-label-color);
      cursor: pointer;
      font: inherit;
      font-size: 0.75rem;
      margin-top: 2px;
      padding: 4px 8px;
    }

    .note.busy {
      opacity: 0.7;
    }

    /* ---- Cards ---- */
    .card {
      background: var(--outline-card-background);
      border: var(--outline-hairline);
      border-radius: 18px;
      box-sizing: border-box;
      padding: 14px 16px;
    }

    .server {
      -webkit-tap-highlight-color: transparent;
      align-items: center;
      color: inherit;
      cursor: pointer;
      display: flex;
      font: inherit;
      gap: 14px;
      text-align: left;
      width: 100%;
    }

    .server-icon {
      align-items: center;
      background: rgba(var(--outline-primary-rgb), 0.16);
      border-radius: 14px;
      color: var(--outline-primary);
      display: flex;
      flex: none;
      font-size: 1.5rem;
      height: 48px;
      justify-content: center;
      width: 48px;
    }

    .server-icon md-icon {
      --md-icon-size: 26px;
      font-size: 26px;
    }

    .server-text {
      flex: 1;
      min-width: 0;
    }

    .server-name {
      font-size: 1.02rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .server-details {
      color: var(--outline-label-color);
      font-size: 0.8rem;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chevron {
      color: var(--outline-label-color);
      flex: none;
    }

    .account-head {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .account-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .badge {
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
    }

    .badge.ok {
      background: rgba(var(--outline-primary-rgb), 0.16);
      color: var(--outline-primary);
    }

    .badge.bad {
      background: rgba(220, 38, 38, 0.15);
      color: #ef4444;
    }

    .row {
      align-items: baseline;
      display: flex;
      font-size: 0.86rem;
      justify-content: space-between;
    }

    .row .muted {
      color: var(--outline-label-color);
    }

    .row b {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .bar {
      background: rgba(127, 127, 127, 0.18);
      border-radius: 99px;
      height: 6px;
      margin: 10px 0 12px;
      overflow: hidden;
    }

    .fill {
      background: linear-gradient(
        90deg,
        #f97316,
        color-mix(in srgb, var(--outline-primary) 80%, #f97316)
      );
      border-radius: inherit;
      height: 100%;
      min-width: 6px;
      transition: width 0.6s ease;
    }

    .fill.warn {
      background: #ef4444;
    }

    .meta {
      align-items: center;
      display: flex;
      font-size: 0.82rem;
      gap: 16px;
      justify-content: space-between;
    }

    .meta span {
      align-items: center;
      display: inline-flex;
      gap: 6px;
      min-width: 0;
    }

    .meta md-icon {
      --md-icon-size: 18px;
      color: var(--outline-label-color);
      font-size: 18px;
    }

    .meta .soon {
      color: #eab308;
    }

    .meta .gone {
      color: #ef4444;
    }

    .speeds {
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr 1fr;
    }

    .speed-head {
      align-items: center;
      color: var(--outline-label-color);
      display: flex;
      font-size: 0.82rem;
      gap: 10px;
      margin-bottom: 12px;
    }

    .speed-icon {
      align-items: center;
      border-radius: 10px;
      display: flex;
      height: 32px;
      justify-content: center;
      width: 32px;
    }

    .speed-icon md-icon {
      --md-icon-size: 18px;
      font-size: 18px;
    }

    .speed-icon.down {
      background: rgba(var(--outline-primary-rgb), 0.16);
      color: var(--outline-primary);
    }

    .speed-icon.up {
      background: rgba(59, 130, 246, 0.16);
      color: #60a5fa;
    }

    .speed-value {
      font-size: 1.35rem;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      white-space: nowrap;
    }

    .speed-total {
      color: var(--outline-label-color);
      font-size: 0.75rem;
      margin-top: 2px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  /** The app's UI language (not the page's static lang="en"). */
  private get locale(): string {
    const appLanguage = (
      document.querySelector('app-root') as {language?: string} | null
    )?.language;
    return (appLanguage || navigator.language || 'ru').toLowerCase();
  }

  private get state(): string {
    switch (this.server?.connectionState) {
      case ServerConnectionState.CONNECTED:
        return 'connected';
      case ServerConnectionState.CONNECTING:
        return 'connecting';
      case ServerConnectionState.RECONNECTING:
        return 'reconnecting';
      case ServerConnectionState.DISCONNECTING:
        return 'disconnecting';
    }
    return 'disconnected';
  }

  updated() {
    // Exposed for the styles (:host([state=...])).
    this.setAttribute('state', this.state);
  }

  render() {
    const state = this.state;
    const up = state === 'connected' || state === 'reconnecting';
    const active = state !== 'disconnected';
    return html`
      <section class="hero">
        <button
          class="power"
          ?disabled=${this.disabled && !active}
          aria-label=${this.localize(
            active ? 'proclient-disconnect-label' : 'proclient-connect-label'
          )}
          @click=${() => this.fire('power-toggle')}
        >
          <span class="ring"></span>
          <span class="orbit"></span>
          <span class="arc"></span>
          <span class="core">
            <md-icon>power_settings_new</md-icon>
            <span class="label"
              >${this.localize(
                state === 'connecting'
                  ? 'proclient-cancel-label'
                  : active
                    ? 'proclient-disconnect-label'
                    : 'proclient-connect-label'
              )}</span
            >
          </span>
        </button>
        <div class="status">${this.localize(`proclient-state-${state}`)}</div>
        ${this.location
          ? html`<div class="location">${this.location}</div>`
          : nothing}
        ${up
          ? html`<div class="timer">
              <connection-timer
                server-id=${this.server?.id ?? ''}
                connection-state=${this.server?.connectionState ?? ''}
              ></connection-timer>
            </div>`
          : nothing}
        ${this.note
          ? html`<button
              class="note ${this.busy ? 'busy' : ''}"
              @click=${() => this.fire('status-tap')}
            >
              ${this.note}
            </button>`
          : nothing}
      </section>

      ${this.renderServer()} ${this.renderAccount()} ${this.renderSpeeds()}
    `;
  }

  private renderServer() {
    const server = this.server;
    const flag = server ? leadingFlag(server.name) : '';
    return html`<button
      class="card server"
      @click=${() => this.fire('open-profiles')}
    >
      <span class="server-icon"
        >${flag ? flag : html`<md-icon>public</md-icon>`}</span
      >
      <span class="server-text">
        <div class="server-name">
          ${server
            ? withoutFlag(server.name)
            : this.localize('proclient-no-server')}
        </div>
        ${this.details
          ? html`<div class="server-details">${this.details}</div>`
          : nothing}
      </span>
      <md-icon class="chevron">chevron_right</md-icon>
    </button>`;
  }

  private renderAccount() {
    const sub = this.subscription;
    const info = sub?.userInfo;
    if (!sub || !info) return nothing;
    const used = info.upload + info.download;
    const total = info.total;
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const expireMs = info.expire ? info.expire * 1000 : 0;
    const left = expireMs ? expireMs - Date.now() : Infinity;
    const expired = left <= 0 || (total > 0 && used >= total);
    const days = Math.max(0, Math.ceil(left / DAY_MS));
    const date = expireMs
      ? new Date(expireMs).toLocaleDateString(this.locale, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : '';
    return html`<section class="card">
      <div class="account-head">
        <span class="account-title">${this.localize('proclient-account')}</span>
        <span class="badge ${expired ? 'bad' : 'ok'}"
          >${this.localize(
            expired ? 'proclient-account-expired' : 'proclient-account-active'
          )}</span
        >
      </div>
      <div class="row">
        <span class="muted">${this.localize('proclient-traffic')}</span>
        <b
          >${formatBytes(used, this.locale)} /
          ${total > 0
            ? formatBytes(total, this.locale)
            : this.localize('proclient-unlimited')}</b
        >
      </div>
      <div class="bar">
        <div
          class="fill ${pct >= 90 ? 'warn' : ''}"
          style="width: ${total > 0 ? pct.toFixed(1) : 100}%"
        ></div>
      </div>
      <div class="meta">
        <span
          class=${!expireMs ? '' : left <= 0 ? 'gone' : days <= 3 ? 'soon' : ''}
        >
          <md-icon>calendar_today</md-icon>
          ${expireMs
            ? left <= 0
              ? this.localize('proclient-expired')
              : `${date} · ${this.localize('proclient-days-short', 'days', String(days))}`
            : this.localize('proclient-no-expiry')}
        </span>
        <span>
          <md-icon>dns</md-icon>
          ${this.localize(
            'proclient-subscription-servers',
            'count',
            String(sub.serverCount ?? 0)
          )}
        </span>
      </div>
    </section>`;
  }

  private renderSpeeds() {
    const t = this.traffic;
    if (!t?.available) return nothing;
    return html`<section class="speeds">
      <div class="card">
        <div class="speed-head">
          <span class="speed-icon down"><md-icon>arrow_downward</md-icon></span>
          ${this.localize('proclient-download')}
        </div>
        <div class="speed-value">${formatSpeed(t.downBps, this.locale)}</div>
        <div class="speed-total">
          ${this.localize(
            'proclient-total',
            'size',
            formatBytes(t.sessionDown, this.locale)
          )}
        </div>
      </div>
      <div class="card">
        <div class="speed-head">
          <span class="speed-icon up"><md-icon>arrow_upward</md-icon></span>
          ${this.localize('proclient-upload')}
        </div>
        <div class="speed-value">${formatSpeed(t.upBps, this.locale)}</div>
        <div class="speed-total">
          ${this.localize(
            'proclient-total',
            'size',
            formatBytes(t.sessionUp, this.locale)
          )}
        </div>
      </div>
    </section>`;
  }

  private fire(type: string) {
    this.dispatchEvent(new CustomEvent(type, {bubbles: true, composed: true}));
  }
}

const FLAG = /^\s*([\u{1F1E6}-\u{1F1FF}]{2})\s*/u;

function leadingFlag(name: string): string {
  return FLAG.exec(name)?.[1] ?? '';
}

function withoutFlag(name: string): string {
  return name.replace(FLAG, '') || name;
}
