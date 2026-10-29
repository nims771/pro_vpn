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

// Fork: bottom tab bar — VPN, Profiles (servers and subscriptions), Settings.

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

const TABS = [
  {id: 'vpn', icon: 'shield', label: 'proclient-tab-vpn'},
  {id: 'profiles', icon: 'layers', label: 'proclient-tab-profiles'},
  {id: 'settings', icon: 'settings', label: 'proclient-tab-settings'},
];

@customElement('bottom-tabs')
export class BottomTabs extends LitElement {
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: String}) active = 'vpn';

  static styles = css`
    :host {
      background: var(--outline-card-background);
      border-top: var(--outline-hairline);
      box-sizing: border-box;
      display: flex;
      flex: none;
      font-family: var(--outline-font-family);
      justify-content: space-around;
      padding: 6px 8px max(8px, env(safe-area-inset-bottom));
    }

    :host([hidden]) {
      display: none;
    }

    button {
      -webkit-tap-highlight-color: transparent;
      align-items: center;
      background: none;
      border: 0;
      color: var(--outline-label-color);
      cursor: pointer;
      display: flex;
      flex: 1;
      flex-direction: column;
      font: inherit;
      font-size: 0.75rem;
      font-weight: 500;
      gap: 3px;
      max-width: 140px;
      padding: 2px 0;
    }

    .pill {
      align-items: center;
      border-radius: 99px;
      display: flex;
      height: 32px;
      justify-content: center;
      transition: background 0.25s ease;
      width: 64px;
    }

    md-icon {
      --md-icon-size: 24px;
      font-size: 24px;
    }

    button[aria-selected='true'] {
      color: var(--outline-text-color);
      font-weight: 700;
    }

    button[aria-selected='true'] .pill {
      background: rgba(var(--outline-primary-rgb), 0.2);
      color: var(--outline-primary);
    }
  `;

  render() {
    return html`${TABS.map(
      tab =>
        html`<button
          role="tab"
          aria-selected=${tab.id === this.active ? 'true' : 'false'}
          @click=${() => this.select(tab.id)}
        >
          <span class="pill"><md-icon>${tab.icon}</md-icon></span>
          ${this.localize(tab.label)}
        </button>`
    )}`;
  }

  private select(tab: string) {
    this.dispatchEvent(
      new CustomEvent('tab-select', {
        detail: {tab},
        bubbles: true,
        composed: true,
      })
    );
  }
}
