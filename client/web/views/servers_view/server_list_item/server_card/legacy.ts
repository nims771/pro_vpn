/*
  Copyright 2021 The Outline Authors
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

import {Corner, type Menu} from '@material/web/menu/menu';

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {createRef, Ref, ref} from 'lit/directives/ref.js';

import '../../server_connection_indicator';
import './server_rename_dialog';
import './server_info_dialog';
import '../proclient_ui';
import {ServerListItem, ServerListItemElement, ServerListItemEvent} from '..';
import {ServerConnectionState} from '../../server_connection_indicator';

const sharedCSS = css`
  /* TODO(daniellacosse): reset via postcss */
  h2,
  span,
  footer,
  button,
  div {
    all: initial;
  }

  * {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  :host {
    --server-name-size: 1rem;
    --server-address-size: 0.875rem;

    display: inline-block;
    height: 100%;
    position: relative;
    width: 100%;
  }

  .card {
    align-items: center;
    background: var(--outline-card-background);
    border-radius: var(--outline-corner);
    box-shadow: var(--outline-elevation);
    display: grid;
    gap: var(--outline-slim-gutter);
    grid-gap: var(--outline-slim-gutter);
    overflow: hidden;
    width: 100%;
  }

  .card-metadata {
    font-family: var(--outline-font-family);
    color: var(--outline-text-color);
    gap: var(--outline-slim-gutter);
    grid-area: metadata;
    display: flex;
    align-items: center;
  }

  server-connection-indicator {
    min-height: var(--min-indicator-size);
    max-height: var(--max-indicator-size);
  }

  .card-metadata-server-name,
  .card-metadata-server-address {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    font-family: var(--outline-font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-user-select: text;
    user-select: text;
  }

  .card-metadata-server-name {
    /* https://caniuse.com/?search=line-clamp */
    -webkit-line-clamp: 3;
    color: var(--outline-text-color);
    font-size: var(--server-name-size);
    margin-bottom: var(--outline-mini-gutter);
    /* To break the line in case a sequence of word characters is longer than the line.
       See https://github.com/OutlineFoundation/outline-apps/issues/1372. */
    word-break: break-all;
  }

  .card-metadata-server-address {
    /* https://caniuse.com/?search=line-clamp */
    -webkit-line-clamp: 2;
    color: var(--outline-label-color);
    font-size: var(--server-address-size);
    word-break: break-all;
  }

  .card-menu {
    --md-menu-container-color: var(--outline-card-background);
  }

  .card-menu-button {
    align-self: start;
    grid-area: menu;
    position: relative;
  }

  .card-menu-button md-icon {
    color: var(--outline-text-color);
  }

  .card-footer {
    background: var(--outline-card-footer);
    border-top: var(--outline-hairline);
    box-sizing: border-box;
    grid-area: footer;
    padding: var(--outline-mini-gutter) var(--outline-gutter);
    text-align: end;
  }

  .card-error {
    color: var(--outline-error);
    margin: 0 var(--outline-slim-gutter);
  }

  .card-footer-button {
    --md-sys-color-primary: var(--outline-primary);

    text-transform: uppercase;
  }

  /* Fork: connection status line ("● Подключен · 00:12:34"). */
  .card-status {
    align-items: center;
    color: var(--outline-label-color);
    display: flex;
    font-family: var(--outline-font-family);
    font-size: var(--server-address-size);
    gap: 6px;
    margin-top: 6px;
  }

  /* the shared reset above sets "all: initial" on spans */
  .card-status > span:not(.card-status-dot) {
    color: inherit;
    font: inherit;
  }

  .card-status-dot {
    background: var(--outline-medium-gray, #9e9e9e);
    border-radius: 50%;
    display: inline-block;
    flex: none;
    height: 8px;
    transition: background 0.3s ease;
    width: 8px;
  }

  .card-status[data-state='connected'] {
    color: var(--outline-primary);
  }

  .card-status[data-state='connected'] .card-status-dot {
    background: var(--outline-primary);
    box-shadow: 0 0 0 3px rgba(var(--outline-primary-rgb), 0.2);
  }

  .card-status[data-state='connecting'] .card-status-dot,
  .card-status[data-state='reconnecting'] .card-status-dot {
    animation: status-blink 1s ease-in-out infinite;
    background: var(--outline-warning, #f9c800);
  }

  .card-status connection-timer {
    color: var(--outline-text-color);
    font-family: var(--outline-font-family);
  }

  @keyframes status-blink {
    50% {
      opacity: 0.3;
    }
  }
`;

/** Fork: servers whose name has no country flag get a globe instead. */
function withFlag(name: string): string {
  return /^\s*[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name) ? name : `🌐 ${name}`;
}

// TODO(daniellacosse): wrap components in a closure to avoid unnecessary work
const getSharedComponents = (element: ServerListItemElement & LitElement) => {
  const {server, localize, menu, menuButton} = element;
  const isConnectedState = [
    ServerConnectionState.CONNECTING,
    ServerConnectionState.CONNECTED,
    ServerConnectionState.RECONNECTING,
  ].includes(server.connectionState);
  const hasErrorMessage = Boolean(server.errorMessageId);

  const messages = {
    serverName: server.name,
    error: hasErrorMessage ? localize(server.errorMessageId) : '',
    connectButton: localize(
      isConnectedState ? 'disconnect-button-label' : 'connect-button-label'
    ),
    status: localize(`${server.connectionState}-server-state`),
  };

  const isUp =
    server.connectionState === ServerConnectionState.CONNECTED ||
    server.connectionState === ServerConnectionState.RECONNECTING;

  const dispatchers = {
    beginRename: () => (element.isRenameDialogOpen = true),
    submitRename: (event: CustomEvent) => {
      element.isRenameDialogOpen = false;

      element.dispatchEvent(
        new CustomEvent(ServerListItemEvent.RENAME, {
          detail: {serverId: event.detail.id, newName: event.detail.name},
          bubbles: true,
          composed: true,
        })
      );
    },
    forget: () =>
      element.dispatchEvent(
        new CustomEvent(ServerListItemEvent.FORGET, {
          detail: {serverId: server.id},
          bubbles: true,
          composed: true,
        })
      ),
    connectToggle: () =>
      element.dispatchEvent(
        new CustomEvent(
          isConnectedState
            ? ServerListItemEvent.DISCONNECT
            : ServerListItemEvent.CONNECT,
          {
            detail: {serverId: server.id},
            bubbles: true,
            composed: true,
          }
        )
      ),
  };

  const handleMenuOpen = () => {
    const menuElement = menu.value;
    const menuButtonElement = menuButton.value;

    if (!menuElement) {
      return;
    }

    if (!menuElement.anchorElement) {
      menuElement.anchorElement = menuButtonElement;
    }

    menuElement.show();
  };

  return {
    messages,
    dispatchers,
    elements: {
      metadataText: html`
        <div class="card-metadata-text">
          <h2 class="card-metadata-server-name" id="server-name">
            ${withFlag(messages.serverName)}
          </h2>
        </div>
      `,
      status: html`
        <div class="card-status" data-state=${server.connectionState}>
          <span class="card-status-dot"></span>
          <span>${messages.status}</span>
          ${isUp ? html`<span>·</span>` : ''}
          <connection-timer
            server-id=${server.id}
            connection-state=${server.connectionState}
          ></connection-timer>
        </div>
      `,
      powerButton: (size: 'large' | 'small') => html`
        <power-button
          size=${size}
          connection-state=${server.connectionState}
          label=${messages.connectButton}
          ?disabled=${hasErrorMessage}
          @click=${() => !hasErrorMessage && dispatchers.connectToggle()}
        ></power-button>
      `,
      // Fork: the footer now only shows errors; the power button replaces the
      // old "CONNECT" text button.
      errorFooter: hasErrorMessage
        ? html`<footer class="card-footer">
            <span class="card-error">${messages.error}</span>
          </footer>`
        : '',
      menu: html`
        <md-menu
          ${ref(menu)}
          class="card-menu"
          menuCorner=${Corner.END_END}
          quick
        >
          <md-menu-item @click="${dispatchers.beginRename}">
            ${localize('server-rename')}
          </md-menu-item>
          <md-menu-item @click="${dispatchers.forget}">
            ${localize('server-forget')}
          </md-menu-item>
        </md-menu>
      `,
      menuButton: html`
        <md-icon-button
          ${ref(menuButton)}
          class="card-menu-button"
          @click=${handleMenuOpen}
        >
          <md-icon>more_vert</md-icon>
        </md-icon-button>
      `,
      footer: html`
        <footer class="card-footer">
          <span class="card-error">${messages.error}</span>
          <md-text-button
            class="card-footer-button"
            @click="${dispatchers.connectToggle}"
            ?disabled=${hasErrorMessage}
          >
            ${messages.connectButton}
          </md-text-button>
        </footer>
      `,
      renameDialog: html`<server-rename-dialog
        .open=${element.isRenameDialogOpen}
        .localize=${localize}
        .serverId=${server.id}
        .serverName=${server.name}
        @cancel=${() => (element.isRenameDialogOpen = false)}
        @submit=${dispatchers.submitRename}
      ></server-rename-dialog>`,
    },
  };
};

/**
 * Display a Server as a part of a larger collection.
 */
@customElement('server-row-card')
export class ServerRowCard extends LitElement implements ServerListItemElement {
  @property({type: Boolean}) darkMode = false;
  @property({type: Object}) server: ServerListItem;
  @property({type: Object}) localize: Localizer;
  /** Fork: the server the bottom connect button acts on. */
  @property({type: Boolean, reflect: true}) selected = false;
  /** Fork: latency in ms; null = no answer; undefined = not measured. */
  @property({attribute: false}) ping?: number | null;
  @property({type: Boolean}) pinging = false;

  @state() isRenameDialogOpen = false;

  menu: Ref<Menu> = createRef();
  menuButton: Ref<HTMLElement> = createRef();

  static styles = [
    sharedCSS,
    css`
      .card {
        --min-indicator-size: calc(
          var(--server-name-size) + var(--outline-mini-gutter) +
            var(--server-address-size)
        );
        --max-indicator-size: calc(
          var(--outline-slim-gutter) + var(--server-name-size) +
            var(--outline-mini-gutter) + var(--server-address-size) +
            var(--outline-slim-gutter)
        );

        /* Fork: radio | flag+name/status | ping | menu; tap selects it */
        --server-name-size: 0.95rem;
        border: 2px solid transparent;
        border-radius: 14px;
        box-sizing: border-box;
        cursor: pointer;
        gap: 0 10px;
        grid-gap: 0 10px;
        grid-template-columns: auto 1fr auto auto;
        grid-template-rows: auto auto;
        grid-template-areas:
          'radio metadata ping menu'
          'footer footer footer footer';
        padding: 6px 0 6px 12px;
        transition:
          border-color 0.25s ease,
          background 0.25s ease;
      }

      :host([selected]) .card {
        background: linear-gradient(
            rgba(var(--outline-primary-rgb), 0.07),
            rgba(var(--outline-primary-rgb), 0.07)
          ),
          var(--outline-card-background);
        border-color: var(--outline-primary);
      }

      .card-radio {
        align-self: center;
        border: 2px solid var(--outline-label-color);
        border-radius: 50%;
        box-sizing: border-box;
        display: grid;
        grid-area: radio;
        height: 22px;
        place-items: center;
        transition: border-color 0.25s ease;
        width: 22px;
      }

      .card-radio::after {
        background: var(--outline-primary);
        border-radius: 50%;
        content: '';
        height: 10px;
        transform: scale(0);
        transition: transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1);
        width: 10px;
      }

      :host([selected]) .card-radio {
        border-color: var(--outline-primary);
      }

      :host([selected]) .card-radio::after {
        transform: scale(1);
      }

      .card-footer {
        margin: 6px 0 -6px -12px;
      }

      .card-metadata-server-name {
        margin-bottom: 0;
      }

      .card-status {
        font-size: 0.72rem;
        margin-top: 2px;
      }

      .card-radio {
        height: 18px;
        width: 18px;
      }

      .card-radio::after {
        height: 8px;
        width: 8px;
      }

      .card-ping {
        align-self: center;
        border-radius: 99px;
        font-family: var(--outline-font-family);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        grid-area: ping;
        min-width: 44px;
        padding: 3px 8px;
        text-align: center;
        white-space: nowrap;
      }

      .card-ping.good {
        background: rgba(22, 163, 74, 0.13);
        color: #15803d;
      }

      .card-ping.ok {
        background: rgba(234, 179, 8, 0.16);
        color: #a16207;
      }

      .card-ping.bad,
      .card-ping.dead {
        background: rgba(220, 38, 38, 0.12);
        color: #b91c1c;
      }

      .card-ping.wait {
        animation: ping-wait 1s ease-in-out infinite;
        background: rgba(0, 0, 0, 0.06);
        color: var(--outline-label-color);
      }

      @keyframes ping-wait {
        50% {
          opacity: 0.4;
        }
      }

      .card-menu-button {
        align-self: center;
        margin-right: -8px;
      }
    `,
  ];

  render() {
    const {elements} = getSharedComponents(this);

    return html`
      <div
        class="card"
        role="radio"
        aria-checked=${this.selected ? 'true' : 'false'}
        tabindex="0"
        @click=${this.select}
        @keydown=${(e: KeyboardEvent) =>
          (e.key === 'Enter' || e.key === ' ') && this.select(e)}
      >
        <span class="card-radio"></span>
        <div class="card-metadata" aria-labelledby="server-name">
          <div>${elements.metadataText} ${elements.status}</div>
        </div>
        ${this.renderPing()} ${elements.menuButton} ${elements.errorFooter}
      </div>
      ${elements.menu} ${elements.renameDialog}
    `;
  }

  private renderPing() {
    if (this.pinging && this.ping === undefined) {
      return html`<span class="card-ping wait">···</span>`;
    }
    if (this.ping === undefined) return html`<span></span>`;
    if (this.ping === null) {
      return html`<span
        class="card-ping dead ${this.pinging ? 'wait' : ''}"
        title=${this.localize('unreachable-server-state')}
        >—</span
      >`;
    }
    const level = this.ping < 150 ? 'good' : this.ping < 350 ? 'ok' : 'bad';
    return html`<span class="card-ping ${level} ${this.pinging ? 'wait' : ''}"
      >${this.localize('proclient-ms', 'ms', String(this.ping))}</span
    >`;
  }

  private select(event: Event) {
    // The menu button lives inside the card: don't treat it as a selection.
    if (event.composedPath().some(el => el === this.menuButton.value)) return;
    this.dispatchEvent(
      new CustomEvent('ProclientSelectServer', {
        detail: {serverId: this.server.id},
        bubbles: true,
        composed: true,
      })
    );
  }
}

/**
 * Display a featured Server in a showcase.
 */
@customElement('server-hero-card')
export class ServerHeroCard
  extends LitElement
  implements ServerListItemElement
{
  @property({type: Object}) server: ServerListItem;
  @property({type: Object}) localize: Localizer;
  @property({type: Boolean}) darkMode = false;

  @state() isRenameDialogOpen = false;

  menu: Ref<Menu> = createRef();
  menuButton: Ref<HTMLElement> = createRef();

  static styles = [
    sharedCSS,
    css`
      .card {
        --min-indicator-size: 192px;
        /*
          TODO(daniellacosse): calc() in combination with grid in this way can be inconsistent on iOS.
          May be resolved by autoprefixer as well.
        */
        --max-indicator-size: var(--min-indicator-size);

        grid-template-columns: 0 1fr auto 0;
        grid-template-rows: 0 auto minmax(0, 1fr) auto;
        grid-template-areas:
          '. . . .'
          '. metadata menu .'
          '. button button .'
          'footer footer footer footer';
      }

      .card-connection-button-container {
        grid-area: button;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        height: 100%;
        gap: var(--outline-slim-gutter);
        box-sizing: border-box;
        padding: var(--outline-large-gutter) 0;
      }

      /* Fork: big rounded-square button, status and timer under it. */
      .card-connection-label {
        color: var(--outline-label-color);
        font-size: 0.95rem;
        font-family: var(--outline-font-family);
        padding-top: 1.25rem;
        transition: color 0.3s ease;
      }

      .card-connection-label[data-state='connected'] {
        color: var(--outline-primary);
        font-weight: 500;
      }

      .card-connection-timer {
        color: var(--outline-text-color);
        font-family: var(--outline-font-family);
        font-size: 2rem;
        font-weight: 300;
        min-height: 2.5rem;
      }
    `,
  ];

  render() {
    const {elements, messages} = getSharedComponents(this);

    return html`
      <div class="card">
        <div class="card-metadata" aria-labelledby="server-name">
          ${elements.metadataText}
        </div>
        ${elements.menuButton}
        <div class="card-connection-button-container">
          ${elements.powerButton('large')}
          <label
            class="card-connection-label"
            data-state=${this.server.connectionState}
          >
            ${messages.status}
          </label>
          <connection-timer
            class="card-connection-timer"
            server-id=${this.server.id}
            connection-state=${this.server.connectionState}
          ></connection-timer>
        </div>
        ${elements.errorFooter}
      </div>
      ${elements.menu} ${elements.renameDialog}
    `;
  }
}
