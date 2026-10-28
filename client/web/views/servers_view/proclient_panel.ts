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

// Fork: panel above the server list with the subscription quota (used / total,
// expiry) and the live speed / session traffic while connected.

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement, nothing, PropertyValues} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import {ServerConnectionState} from './server_connection_indicator';
import {ServerListItem} from './server_list_item';
import {formatBytes, formatSpeed} from '../../app/subscriptions/parse';
import {proclientStore, SubscriptionView} from '../../app/subscriptions/store';

const DAY_MS = 24 * 3600 * 1000;

@customElement('proclient-panel')
export class ProclientPanel extends LitElement {
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: Array}) servers: ServerListItem[] = [];

  private unsubscribe?: () => void;

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
      padding: 6px 8px 0;
      font-family: var(--outline-font-family);
      color: var(--outline-text-color);
    }

    .panel {
      background: var(--outline-card-background);
      border-radius: 14px;
      box-shadow: var(--outline-elevation);
      overflow: hidden;
    }

    .sub + .sub,
    .sub + .speed {
      border-top: var(--outline-hairline, 1px solid rgba(0, 0, 0, 0.08));
    }

    .sub {
      padding: 8px 6px 10px 12px;
    }

    .sub-head {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .sub-icon {
      background: rgba(var(--outline-primary-rgb), 0.12);
      border-radius: 8px;
      color: var(--outline-primary);
      display: grid;
      flex: none;
      height: 28px;
      place-items: center;
      width: 28px;
      --md-icon-size: 18px;
    }

    .sub-title {
      flex: 1;
      min-width: 0;
    }

    .sub-name {
      font-size: 0.88rem;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sub-meta {
      color: var(--outline-label-color);
      font-size: 0.68rem;
      margin-top: 0;
    }

    .sub-meta.error {
      color: var(--outline-error);
    }

    md-icon-button {
      --md-icon-button-icon-color: var(--outline-label-color);
      --md-icon-button-icon-size: 20px;
      --md-icon-button-state-layer-height: 32px;
      --md-icon-button-state-layer-width: 32px;
      flex: none;
      height: 32px;
      width: 32px;
    }

    .spin md-icon {
      animation: spin 0.9s linear infinite;
    }

    .bar {
      background: rgba(var(--outline-primary-rgb), 0.14);
      border-radius: 99px;
      height: 5px;
      margin: 8px 6px 0 0;
      overflow: hidden;
    }

    .fill {
      background: linear-gradient(
        90deg,
        var(--outline-primary),
        var(--outline-primary-dark, var(--outline-primary))
      );
      border-radius: inherit;
      height: 100%;
      transition: width 0.6s ease;
    }

    .fill.warn {
      background: var(--outline-error);
    }

    .sub-row {
      display: flex;
      flex-wrap: wrap;
      font-size: 0.7rem;
      gap: 2px 10px;
      justify-content: space-between;
      margin: 5px 6px 0 0;
    }

    .muted {
      color: var(--outline-label-color);
    }

    .danger {
      color: var(--outline-error);
      font-weight: 500;
    }

    .speed {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: 1fr 1fr;
      padding: 6px 12px 8px;
    }

    .speed-item {
      align-items: center;
      display: flex;
      gap: 6px;
      min-width: 0;
    }

    .speed-arrow {
      border-radius: 6px;
      display: grid;
      flex: none;
      height: 22px;
      place-items: center;
      width: 22px;
    }

    .speed-arrow.down {
      background: rgba(var(--outline-primary-rgb), 0.14);
      color: var(--outline-primary);
    }

    .speed-arrow.up {
      background: rgba(250, 140, 22, 0.15);
      color: #e8790f;
    }

    .speed-arrow md-icon {
      font-size: 15px;
      --md-icon-size: 15px;
    }

    .speed-value {
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      white-space: nowrap;
    }

    .speed-session {
      color: var(--outline-label-color);
      font-size: 0.72rem;
      line-height: 1.35;
      text-align: right;
      white-space: nowrap;
    }

    .speed-session b {
      color: var(--outline-text-color);
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = proclientStore.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('servers')) {
      proclientStore.setVpnActive(this.vpnActive);
    }
  }

  private get vpnActive(): boolean {
    return (this.servers ?? []).some(
      s =>
        s.connectionState === ServerConnectionState.CONNECTED ||
        s.connectionState === ServerConnectionState.RECONNECTING
    );
  }

  /** The app's UI language (not the page's static lang="en"). */
  private get locale(): string {
    const appLanguage = (
      document.querySelector('app-root') as {language?: string} | null
    )?.language;
    return (appLanguage || navigator.language || 'ru').toLowerCase();
  }

  render() {
    const subs = proclientStore.subscriptions;
    const traffic = proclientStore.traffic;
    const showSpeed = this.vpnActive && traffic.available;
    if (!subs.length && !showSpeed) return nothing;

    return html`
      <section class="panel">
        ${subs.map(s => this.renderSubscription(s))}
        ${showSpeed ? this.renderSpeed() : nothing}
      </section>
    `;
  }

  private renderSubscription(s: SubscriptionView) {
    const info = s.userInfo;
    const used = info ? info.upload + info.download : 0;
    const total = info?.total ?? 0;
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

    let meta = this.localize(
      'proclient-subscription-servers',
      'count',
      String(s.serverCount ?? 0)
    );
    if (s.lastError)
      meta += ` · ${this.localize('proclient-subscription-error')}`;

    return html`
      <div class="sub">
        <div class="sub-head">
          <div class="sub-icon">
            <md-icon>cloud_sync</md-icon>
          </div>
          <div class="sub-title">
            <div class="sub-name">${s.title || s.url}</div>
            <div class="sub-meta ${s.lastError ? 'error' : ''}">${meta}</div>
          </div>
          <md-icon-button
            class=${s.refreshing ? 'spin' : ''}
            title=${this.localize('proclient-subscription-refresh')}
            @click=${() => this.fire('ProclientRefreshSubscription', s.id)}
          >
            <md-icon>refresh</md-icon>
          </md-icon-button>
          <md-icon-button
            title=${this.localize('proclient-subscription-delete')}
            @click=${() => this.fire('ProclientDeleteSubscription', s.id)}
          >
            <md-icon>delete_outline</md-icon>
          </md-icon-button>
        </div>
        ${info
          ? html`
              <div class="bar">
                <div
                  class="fill ${total > 0 && pct >= 90 ? 'warn' : ''}"
                  style="width: ${total > 0 ? pct.toFixed(1) : 100}%"
                ></div>
              </div>
              <div class="sub-row">
                <span>${this.renderUsage(used, total)}</span>
                ${this.renderExpiry(info.expire)}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderUsage(used: number, total: number) {
    const usedText = formatBytes(used, this.locale);
    if (total <= 0) {
      return this.localize('proclient-traffic-unlimited', 'used', usedText);
    }
    return this.localize(
      'proclient-traffic-of',
      'used',
      usedText,
      'total',
      formatBytes(total, this.locale)
    );
  }

  private renderExpiry(expire: number) {
    if (!expire) {
      return html`<span class="muted"
        >${this.localize('proclient-no-expiry')}</span
      >`;
    }
    const ms = expire * 1000;
    const left = ms - Date.now();
    if (left <= 0) {
      return html`<span class="danger"
        >${this.localize('proclient-expired')}</span
      >`;
    }
    const date = new Date(ms).toLocaleDateString(this.locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const days = Math.ceil(left / DAY_MS);
    return html`<span class=${days <= 3 ? 'danger' : 'muted'}>
      ${this.localize('proclient-expires', 'date', date)} ·
      ${this.localize('proclient-days-left', 'days', String(days))}
    </span>`;
  }

  private renderSpeed() {
    const t = proclientStore.traffic;
    return html`
      <div class="speed">
        <div class="speed-item">
          <span class="speed-arrow down"
            ><md-icon>arrow_downward</md-icon></span
          >
          <span class="speed-value"
            >${formatSpeed(t.downBps, this.locale)}</span
          >
        </div>
        <div class="speed-item">
          <span class="speed-arrow up"><md-icon>arrow_upward</md-icon></span>
          <span class="speed-value">${formatSpeed(t.upBps, this.locale)}</span>
        </div>
      </div>
    `;
  }

  private fire(type: string, id: string) {
    this.dispatchEvent(
      new CustomEvent(type, {detail: {id}, bubbles: true, composed: true})
    );
  }
}
