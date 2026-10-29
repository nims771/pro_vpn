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

// Fork: "Settings" page — VPN options, look (theme, colors) and this
// device's HWID.

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import {DeviceInfo, getDeviceInfo} from '../../app/device';
import {
  canOpenSystemVpnSettings,
  getSettings,
  onSettingsChange,
  openSystemVpnSettingsScreen,
  ProclientSettings,
  updateSettings,
} from '../../app/proclient_settings';
import {
  Accent,
  ACCENTS,
  getAccent,
  onAccentChange,
  setAccent,
} from '../../app/theme';

type BoolKey = {
  [K in keyof ProclientSettings]: ProclientSettings[K] extends boolean
    ? K
    : never;
}[keyof ProclientSettings];

const REFRESH_OPTIONS = [0, 1, 6, 24, -1];

@customElement('settings-view')
export class SettingsView extends LitElement {
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: String}) version = '';
  @property({type: String}) build = '';

  @state() private settings: ProclientSettings = getSettings();
  @state() private info?: DeviceInfo;
  @state() private copied = false;
  @state() private accent: Accent = getAccent();
  @state() private appearance = currentAppearance();
  private copiedTimer?: number;
  private unsubscribe?: () => void;
  private unsubscribeAccent?: () => void;

  static styles = css`
    :host {
      box-sizing: border-box;
      color: var(--outline-text-color);
      display: block;
      font-family: var(--outline-font-family);
      margin: 0 auto;
      max-width: 520px;
      padding: 8px 12px 24px;
      width: 100%;
    }

    h3 {
      color: var(--outline-primary);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      margin: 18px 6px 8px;
      text-transform: uppercase;
    }

    .card {
      background: var(--outline-card-background);
      border-radius: 14px;
      box-shadow: var(--outline-elevation);
      overflow: hidden;
    }

    .row {
      align-items: center;
      display: flex;
      gap: 12px;
      padding: 12px 14px;
    }

    .row + .row {
      border-top: var(--outline-hairline, 1px solid rgba(0, 0, 0, 0.08));
    }

    label.row {
      cursor: pointer;
    }

    .text {
      flex: 1;
      min-width: 0;
    }

    .title {
      font-size: 0.92rem;
    }

    .desc {
      color: var(--outline-label-color);
      font-size: 0.75rem;
      line-height: 1.35;
      margin-top: 2px;
    }

    /* Switch */
    .switch {
      flex: none;
      height: 26px;
      position: relative;
      width: 46px;
    }

    .switch input {
      height: 0;
      opacity: 0;
      position: absolute;
      width: 0;
    }

    .track {
      background: rgba(0, 0, 0, 0.22);
      border-radius: 99px;
      inset: 0;
      position: absolute;
      transition: background 0.2s ease;
    }

    .track::after {
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      content: '';
      height: 20px;
      left: 3px;
      position: absolute;
      top: 3px;
      transition: transform 0.2s ease;
      width: 20px;
    }

    input:checked + .track {
      background: var(--outline-primary);
    }

    input:checked + .track::after {
      transform: translateX(20px);
    }

    select {
      background: var(--outline-card-background);
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 8px;
      color: var(--outline-text-color);
      font: inherit;
      font-size: 0.85rem;
      padding: 6px 8px;
    }

    .action {
      background: rgba(var(--outline-primary-rgb), 0.1);
      border: 0;
      border-radius: 8px;
      color: var(--outline-primary);
      cursor: pointer;
      flex: none;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 8px 12px;
    }

    .hwid-row {
      align-items: center;
      display: flex;
      gap: 10px;
      padding: 12px 14px 0;
    }

    .hwid {
      background: rgba(var(--outline-primary-rgb), 0.08);
      border: 1px solid rgba(var(--outline-primary-rgb), 0.25);
      border-radius: 10px;
      flex: 1;
      font-family: 'Roboto Mono', ui-monospace, monospace;
      font-size: 0.92rem;
      letter-spacing: 0.02em;
      min-width: 0;
      overflow: hidden;
      padding: 10px 12px;
      text-align: center;
      text-overflow: ellipsis;
      -webkit-user-select: all;
      user-select: all;
      white-space: nowrap;
    }

    .copy {
      align-items: center;
      background: var(--outline-primary);
      border: 0;
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      flex: none;
      height: 44px;
      justify-content: center;
      width: 44px;
    }

    .copy md-icon {
      --md-icon-size: 18px;
      font-size: 18px;
    }

    .hint {
      color: var(--outline-label-color);
      font-size: 0.75rem;
      line-height: 1.4;
      margin: 0;
      padding: 8px 14px 4px;
    }

    .swatches {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
      padding: 4px 14px 14px;
    }

    .swatch {
      aspect-ratio: 1;
      border: 0;
      border-radius: 50%;
      box-shadow:
        inset 0 0 0 2px rgba(255, 255, 255, 0.35),
        0 1px 3px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      display: grid;
      padding: 0;
      place-items: center;
      position: relative;
      transition: transform 0.15s ease;
      width: 100%;
    }

    .swatch:active {
      transform: scale(0.92);
    }

    .swatch.selected {
      box-shadow:
        0 0 0 3px var(--outline-card-background),
        0 0 0 5px var(--outline-text-color);
    }

    .swatch md-icon {
      --md-icon-size: 20px;
      color: #fff;
      font-size: 20px;
    }

    .swatch.custom {
      background: conic-gradient(
        #ef4444,
        #f59e0b,
        #eab308,
        #22c55e,
        #06b6d4,
        #3b82f6,
        #a855f7,
        #ec4899,
        #ef4444
      );
      overflow: hidden;
    }

    .swatch.custom input {
      cursor: pointer;
      height: 100%;
      inset: 0;
      opacity: 0;
      position: absolute;
      width: 100%;
    }

    .preview {
      align-items: center;
      background: var(--outline-dark-primary);
      border-radius: 10px;
      color: #fff;
      display: flex;
      font-size: 0.85rem;
      font-weight: 500;
      gap: 8px;
      justify-content: space-between;
      margin: 0 14px 14px;
      padding: 10px 12px;
    }

    .preview span:last-child {
      background: var(--outline-primary);
      border-radius: 99px;
      font-size: 0.78rem;
      padding: 4px 12px;
    }

    dl {
      display: grid;
      gap: 8px 16px;
      grid-template-columns: auto 1fr;
      margin: 0;
      padding: 8px 14px 14px;
    }

    dt {
      color: var(--outline-label-color);
      font-size: 0.82rem;
    }

    dd {
      font-size: 0.82rem;
      margin: 0;
      text-align: right;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = onSettingsChange(s => (this.settings = s));
    this.unsubscribeAccent = onAccentChange(a => (this.accent = a));
    this.appearance = currentAppearance();
    getDeviceInfo().then(
      info => (this.info = info),
      e => console.warn(`device info failed: ${e}`)
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribeAccent?.();
  }

  private toggle(key: BoolKey, titleKey: string, descKey: string) {
    return html`<label class="row">
      <div class="text">
        <div class="title">${this.localize(titleKey)}</div>
        <div class="desc">${this.localize(descKey)}</div>
      </div>
      <span class="switch">
        <input
          type="checkbox"
          .checked=${this.settings[key]}
          @change=${(e: Event) =>
            updateSettings({[key]: (e.target as HTMLInputElement).checked})}
        />
        <span class="track"></span>
      </span>
    </label>`;
  }

  private refreshLabel(hours: number): string {
    if (hours === 0) return this.localize('proclient-refresh-panel');
    if (hours < 0) return this.localize('proclient-refresh-never');
    return this.localize('proclient-refresh-hours', 'hours', String(hours));
  }

  render() {
    const info = this.info;
    return html`
      <h3>${this.localize('proclient-settings-connection')}</h3>
      <div class="card">
        ${this.toggle(
          'connectOnLaunch',
          'proclient-set-launch',
          'proclient-set-launch-desc'
        )}
        ${this.toggle(
          'failover',
          'proclient-set-failover',
          'proclient-set-failover-desc'
        )}
        ${this.toggle(
          'testAfterConnect',
          'proclient-set-test',
          'proclient-set-test-desc'
        )}
      </div>

      <h3>${this.localize('proclient-settings-servers')}</h3>
      <div class="card">
        ${this.toggle(
          'pingOnOpen',
          'proclient-set-ping',
          'proclient-set-ping-desc'
        )}
        <div class="row">
          <div class="text">
            <div class="title">${this.localize('proclient-set-refresh')}</div>
            <div class="desc">
              ${this.localize('proclient-set-refresh-desc')}
            </div>
          </div>
          <select
            @change=${(e: Event) =>
              updateSettings({
                subscriptionRefreshHours: Number(
                  (e.target as HTMLSelectElement).value
                ),
              })}
          >
            ${REFRESH_OPTIONS.map(
              h =>
                html`<option
                  value=${h}
                  ?selected=${h === this.settings.subscriptionRefreshHours}
                >
                  ${this.refreshLabel(h)}
                </option>`
            )}
          </select>
        </div>
      </div>

      ${canOpenSystemVpnSettings()
        ? html`<h3>${this.localize('proclient-settings-system')}</h3>
            <div class="card">
              <div class="row">
                <div class="text">
                  <div class="title">
                    ${this.localize('proclient-set-killswitch')}
                  </div>
                  <div class="desc">
                    ${this.localize('proclient-set-killswitch-desc')}
                  </div>
                </div>
                <button
                  class="action"
                  @click=${() => {
                    void openSystemVpnSettingsScreen();
                  }}
                >
                  ${this.localize('proclient-open')}
                </button>
              </div>
            </div>`
        : nothing}

      <h3>${this.localize('proclient-settings-appearance')}</h3>
      <div class="card">
        <div class="row">
          <div class="text">
            <div class="title">${this.localize('proclient-set-theme')}</div>
          </div>
          <select
            @change=${(e: Event) =>
              this.setAppearance((e.target as HTMLSelectElement).value)}
          >
            ${(['light', 'dark', 'system'] as const).map(
              mode =>
                html`<option
                  value=${mode}
                  ?selected=${mode === this.appearance}
                >
                  ${this.localize(`proclient-theme-${mode}`)}
                </option>`
            )}
          </select>
        </div>
        <div class="row">
          <div class="text">
            <div class="title">${this.localize('proclient-set-color')}</div>
            <div class="desc">${this.localize('proclient-set-color-desc')}</div>
          </div>
        </div>
        <div class="swatches" role="radiogroup">
          ${ACCENTS.map(
            a =>
              html`<button
                class="swatch ${this.accent.color === a.color
                  ? 'selected'
                  : ''}"
                style="background: linear-gradient(135deg, ${a.color}, ${a.header})"
                role="radio"
                aria-checked=${this.accent.color === a.color ? 'true' : 'false'}
                aria-label=${a.id}
                @click=${() => setAccent(a.id)}
              >
                ${this.accent.color === a.color
                  ? html`<md-icon>check</md-icon>`
                  : nothing}
              </button>`
          )}
          <label
            class="swatch custom ${this.accent.id === 'custom'
              ? 'selected'
              : ''}"
            title=${this.localize('proclient-color-custom')}
            style=${this.accent.id === 'custom'
              ? `background: ${this.accent.color}`
              : ''}
          >
            <md-icon
              >${this.accent.id === 'custom' ? 'check' : 'palette'}</md-icon
            >
            <input
              type="color"
              aria-label=${this.localize('proclient-color-custom')}
              .value=${this.accent.color.toLowerCase()}
              @input=${(e: Event) =>
                setAccent((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="preview">
          <span>${document.title || 'Protected VPN'}</span>
          <span>Connect</span>
        </div>
      </div>

      <h3>${this.localize('device-page-title')}</h3>
      <div class="card">
        <div class="hwid-row">
          <div class="hwid">${info?.hwid ?? '…'}</div>
          <button
            class="copy"
            ?disabled=${!info}
            @click=${this.copy}
            title=${this.localize(
              this.copied ? 'proclient-copied' : 'proclient-copy'
            )}
            aria-label=${this.localize('proclient-copy')}
          >
            <md-icon>${this.copied ? 'check' : 'content_copy'}</md-icon>
          </button>
        </div>
        <p class="hint">${this.localize('proclient-device-hint')}</p>
        ${info
          ? html`<dl>
              <dt>${this.localize('proclient-device-model')}</dt>
              <dd>
                ${[info.manufacturer, info.model].filter(Boolean).join(' ') ||
                '—'}
              </dd>
              <dt>${this.localize('proclient-device-os')}</dt>
              <dd>${[info.os, info.osVersion].filter(Boolean).join(' ')}</dd>
              <dt>${this.localize('proclient-device-app')}</dt>
              <dd>${this.version}${this.build ? ` (${this.build})` : ''}</dd>
            </dl>`
          : nothing}
      </div>
    `;
  }

  private setAppearance(mode: string) {
    this.appearance = mode;
    this.dispatchEvent(
      new CustomEvent('SetAppearanceRequested', {
        detail: {appearance: mode},
        bubbles: true,
        composed: true,
      })
    );
  }

  private async copy() {
    const text = this.info?.hwid;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    this.copied = true;
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => (this.copied = false), 1800);
  }
}

/** Light / dark / system, as last chosen (kept by app-root). */
function currentAppearance(): string {
  const root = document.querySelector('app-root') as {
    selectedAppearance?: string;
  } | null;
  return root?.selectedAppearance || 'system';
}
