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

// Fork: "Device" settings page with this device's HWID.

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import {DeviceInfo, getDeviceInfo} from '../../app/device';

@customElement('device-view')
export class DeviceView extends LitElement {
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: String}) version = '';
  @property({type: String}) build = '';

  @state() private info?: DeviceInfo;
  @state() private copied = false;
  private copiedTimer?: number;

  static styles = css`
    :host {
      box-sizing: border-box;
      color: var(--outline-text-color);
      display: block;
      font-family: var(--outline-font-family);
      margin: 0 auto;
      max-width: 520px;
      padding: 16px;
      width: 100%;
    }

    .card {
      background: var(--outline-card-background);
      border-radius: 14px;
      box-shadow: var(--outline-elevation);
      padding: 16px;
    }

    .label {
      color: var(--outline-label-color);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .hwid-row {
      align-items: center;
      display: flex;
      gap: 10px;
      margin-top: 8px;
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
      text-align: center;
      white-space: nowrap;
      padding: 10px 12px;
      -webkit-user-select: all;
      user-select: all;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .copy {
      align-items: center;
      background: var(--outline-primary);
      border: 0;
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      flex: none;
      height: 44px;
      justify-content: center;
      padding: 0;
      width: 44px;
    }

    .copy md-icon {
      --md-icon-size: 18px;
      font-size: 18px;
    }

    .hint {
      color: var(--outline-label-color);
      font-size: 0.8rem;
      line-height: 1.45;
      margin: 12px 0 0;
    }

    dl {
      display: grid;
      gap: 10px 16px;
      grid-template-columns: auto 1fr;
      margin: 16px 0 0;
    }

    dt {
      color: var(--outline-label-color);
      font-size: 0.85rem;
    }

    dd {
      font-size: 0.85rem;
      margin: 0;
      text-align: right;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    getDeviceInfo().then(
      info => (this.info = info),
      e => console.warn(`device info failed: ${e}`)
    );
  }

  render() {
    const info = this.info;
    return html`
      <div class="card">
        <div class="label">${this.localize('proclient-device-hwid')}</div>
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

  private async copy() {
    const text = this.info?.hwid;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older WebViews: copy through a temporary text area.
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
