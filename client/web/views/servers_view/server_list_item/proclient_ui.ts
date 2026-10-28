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

// Fork UI pieces: rounded-square power button with connection animation,
// connected-time counter and masked server address.

import {css, html, LitElement, PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import {ServerConnectionState} from '../server_connection_indicator';

// ---------------------------------------------------------------------------
// Address masking: keep the beginning, hide the end.

/**
 * Hides the end of a server address so it can't be read off the screen:
 *   185.22.104.17:443   -> 185.22.***.***
 *   [2001:db8::1]:8388  -> 2001:db8:****
 *   vpn.example.com:443 -> vpn.e*********
 */
export function maskAddress(address: string): string {
  if (!address) return '';
  let host = address.trim();

  // Strip the port: "[v6]:port", "v4:port" or "name:port".
  const bracketed = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    host = bracketed[1];
  } else if ((host.match(/:/g) || []).length === 1) {
    host = host.slice(0, host.lastIndexOf(':'));
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    return `${v4[1]}.${v4[2]}.***.***`;
  }
  if (host.includes(':')) {
    const groups = host.split(':').filter(Boolean);
    return `${groups.slice(0, 2).join(':')}:****`;
  }
  const visible = Math.min(5, Math.max(2, Math.floor(host.length / 3)));
  return (
    host.slice(0, visible) + '*'.repeat(Math.max(4, host.length - visible))
  );
}

// ---------------------------------------------------------------------------
// Connected-time bookkeeping. Kept in localStorage so the counter survives an
// app restart while the VPN keeps running in the background.

const SINCE_KEY_PREFIX = 'proclient.connectedSince.';

function readSince(serverId: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(SINCE_KEY_PREFIX + serverId));
    return value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeSince(serverId: string, value: number | undefined) {
  try {
    if (value === undefined) {
      localStorage.removeItem(SINCE_KEY_PREFIX + serverId);
    } else {
      localStorage.setItem(SINCE_KEY_PREFIX + serverId, String(value));
    }
  } catch {
    // Storage unavailable: the counter just restarts next time.
  }
}

const memorySince = new Map<string, number>();

/**
 * Returns when the server got connected, recording "now" the first time it is
 * seen connected. Returns undefined (and forgets the time) once it is
 * disconnected. Reconnecting keeps the original time.
 */
export function trackConnectedSince(
  serverId: string,
  state: ServerConnectionState
): number | undefined {
  if (!serverId) return undefined;
  const isUp =
    state === ServerConnectionState.CONNECTED ||
    state === ServerConnectionState.RECONNECTING;
  if (!isUp) {
    if (state === ServerConnectionState.DISCONNECTED) {
      memorySince.delete(serverId);
      writeSince(serverId, undefined);
    }
    return undefined;
  }
  let since = memorySince.get(serverId) ?? readSince(serverId);
  if (since === undefined || since > Date.now()) {
    since = Date.now();
    writeSince(serverId, since);
  }
  memorySince.set(serverId, since);
  return since;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Live HH:MM:SS counter of how long the server has been connected. */
@customElement('connection-timer')
export class ConnectionTimer extends LitElement {
  @property({attribute: 'server-id'}) serverId = '';
  @property({attribute: 'connection-state'})
  connectionState: ServerConnectionState = ServerConnectionState.DISCONNECTED;

  @state() private now = Date.now();
  private since?: number;
  private ticker?: number;

  static styles = css`
    :host {
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
      letter-spacing: 0.02em;
    }
  `;

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('connectionState') || changed.has('serverId')) {
      this.since = trackConnectedSince(this.serverId, this.connectionState);
      if (this.since === undefined) {
        this.stopTicking();
      } else {
        this.startTicking();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopTicking();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.since !== undefined) this.startTicking();
  }

  private startTicking() {
    if (this.ticker !== undefined) return;
    this.now = Date.now();
    this.ticker = window.setInterval(() => (this.now = Date.now()), 1000);
  }

  private stopTicking() {
    if (this.ticker !== undefined) {
      window.clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  render() {
    if (this.since === undefined) return html``;
    return html`${formatDuration(this.now - this.since)}`;
  }
}

// ---------------------------------------------------------------------------
// Rounded-square power button.

@customElement('power-button')
export class PowerButton extends LitElement {
  @property({attribute: 'connection-state', reflect: true})
  connectionState: ServerConnectionState = ServerConnectionState.DISCONNECTED;
  /** "large" for the single-server screen, "small" for list rows. */
  @property({reflect: true}) size: 'large' | 'small' = 'small';
  @property({type: Boolean, reflect: true}) disabled = false;
  @property() label = '';

  /** Plays a one-shot "pop" right after the connection succeeds. */
  @state() private justConnected = false;
  private popTimer?: number;

  static styles = css`
    :host {
      --size: 56px;
      --radius: 16px;
      --ring: 3px;
      --icon: 28px;
      --accent: var(--outline-primary);
      --accent-dark: var(--outline-primary-dark, var(--outline-primary));
      --surface: var(--outline-card-background);

      display: inline-block;
      position: relative;
      width: var(--size);
      height: var(--size);
      -webkit-tap-highlight-color: transparent;
    }

    :host([size='large']) {
      --size: 116px;
      --radius: 32px;
      --ring: 4px;
      --icon: 52px;
    }

    button {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      border-radius: var(--radius);
      background: var(--surface);
      border: 2px solid var(--accent);
      border: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
      color: var(--accent);
      transition:
        transform 0.15s ease,
        background 0.35s ease,
        border-color 0.35s ease,
        color 0.35s ease,
        box-shadow 0.35s ease;
      z-index: 1;
    }

    button:active {
      transform: scale(0.94);
    }

    button:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
      outline-offset: 4px;
    }

    :host([disabled]) button {
      cursor: default;
      opacity: 0.45;
    }

    svg {
      width: var(--icon);
      height: var(--icon);
      transition: transform 0.4s ease;
    }

    /* ---- connecting / reconnecting: sweeping border + ripples ---- */

    .sweep,
    .ripple {
      position: absolute;
      pointer-events: none;
      border-radius: calc(var(--radius) + var(--ring));
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .sweep {
      inset: calc(var(--ring) * -1);
      overflow: hidden;
      z-index: 0;
    }

    .sweep::before {
      content: '';
      position: absolute;
      inset: -50%;
      background: conic-gradient(
        transparent 0deg,
        transparent 200deg,
        color-mix(in srgb, var(--accent) 35%, transparent) 260deg,
        var(--accent) 340deg,
        #fff 360deg
      );
      animation: spin 1.1s linear infinite;
    }

    .ripple {
      inset: 0;
      border: 2px solid var(--accent);
      z-index: 0;
    }

    :host([connection-state='connecting']) .sweep,
    :host([connection-state='reconnecting']) .sweep {
      opacity: 1;
    }

    :host([connection-state='connecting']) .ripple,
    :host([connection-state='reconnecting']) .ripple {
      animation: ripple 1.8s ease-out infinite;
    }

    :host([connection-state='connecting']) .ripple.r2,
    :host([connection-state='reconnecting']) .ripple.r2 {
      animation-delay: 0.9s;
    }

    :host([connection-state='connecting']) button,
    :host([connection-state='reconnecting']) button {
      border-color: transparent;
      background: var(--surface);
      background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    }

    :host([connection-state='connecting']) svg,
    :host([connection-state='reconnecting']) svg {
      animation: breathe 1.1s ease-in-out infinite;
    }

    /* ---- connected: filled, glowing ---- */

    :host([connection-state='connected']) button {
      border-color: transparent;
      color: #fff;
      background: linear-gradient(145deg, var(--accent), var(--accent-dark));
      animation: glow 3s ease-in-out infinite;
    }

    :host([connection-state='connected']) .pop {
      animation: pop 0.55s cubic-bezier(0.3, 1.6, 0.5, 1);
    }

    .burst {
      position: absolute;
      inset: 0;
      border-radius: var(--radius);
      pointer-events: none;
      opacity: 0;
    }

    .burst.on {
      animation: burst 0.7s ease-out;
    }

    /* ---- disconnecting: fade back ---- */

    :host([connection-state='disconnecting']) button {
      opacity: 0.7;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes ripple {
      0% {
        transform: scale(1);
        opacity: 0.55;
      }
      100% {
        transform: scale(1.55);
        opacity: 0;
      }
    }

    @keyframes breathe {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.55;
        transform: scale(0.9);
      }
    }

    @keyframes glow {
      0%,
      100% {
        box-shadow:
          0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent),
          0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent);
      }
      50% {
        box-shadow:
          0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent),
          0 8px 26px color-mix(in srgb, var(--accent) 55%, transparent);
      }
    }

    @keyframes pop {
      0% {
        transform: scale(0.88);
      }
      100% {
        transform: scale(1);
      }
    }

    @keyframes burst {
      0% {
        opacity: 0.7;
        box-shadow: 0 0 0 0 var(--accent);
      }
      100% {
        opacity: 0;
        box-shadow: 0 0 0 calc(var(--size) * 0.35) transparent;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .sweep::before,
      .ripple,
      svg,
      button,
      .pop,
      .burst.on {
        animation: none !important;
      }
    }
  `;

  willUpdate(changed: PropertyValues<this>) {
    const previous = changed.get('connectionState');
    if (
      changed.has('connectionState') &&
      this.connectionState === ServerConnectionState.CONNECTED &&
      (previous === ServerConnectionState.CONNECTING ||
        previous === ServerConnectionState.RECONNECTING)
    ) {
      this.justConnected = true;
      window.clearTimeout(this.popTimer);
      this.popTimer = window.setTimeout(
        () => (this.justConnected = false),
        800
      );
    }
  }

  render() {
    return html`
      <span class="ripple r1"></span>
      <span class="ripple r2"></span>
      <span class="sweep"></span>
      <button
        class=${this.justConnected ? 'pop' : ''}
        ?disabled=${this.disabled}
        aria-label=${this.label}
        title=${this.label}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3v8"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
          <path
            d="M7.05 6.4a7.5 7.5 0 1 0 9.9 0"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
        <span class="burst ${this.justConnected ? 'on' : ''}"></span>
      </button>
    `;
  }
}

// ---------------------------------------------------------------------------
// Fork: the single wide connect button pinned to the bottom of the screen.

@customElement('connect-button')
export class ConnectButton extends LitElement {
  @property({attribute: 'connection-state', reflect: true})
  connectionState: ServerConnectionState = ServerConnectionState.DISCONNECTED;
  @property({type: Boolean, reflect: true}) disabled = false;
  @property() label = '';
  /** Server id, for the connected-time counter shown inside the button. */
  @property({attribute: 'server-id'}) serverId = '';

  @state() private justConnected = false;
  private popTimer?: number;

  static styles = css`
    :host {
      --accent: var(--outline-primary);
      --accent-dark: var(--outline-primary-dark, var(--outline-primary));
      --radius: 20px;

      display: block;
      position: relative;
      width: 100%;
      -webkit-tap-highlight-color: transparent;
    }

    button {
      all: unset;
      align-items: center;
      background: linear-gradient(135deg, var(--accent), var(--accent-dark));
      border: 2px solid transparent;
      border-radius: var(--radius);
      box-shadow: 0 6px 18px rgba(var(--outline-primary-rgb), 0.35);
      box-sizing: border-box;
      color: #fff;
      cursor: pointer;
      display: flex;
      font-family: var(--outline-font-family);
      font-size: 1.05rem;
      font-weight: 600;
      gap: 12px;
      height: 62px;
      justify-content: center;
      letter-spacing: 0.01em;
      overflow: hidden;
      padding: 0 20px;
      position: relative;
      transition:
        transform 0.15s ease,
        background 0.35s ease,
        color 0.35s ease,
        border-color 0.35s ease,
        box-shadow 0.35s ease;
      width: 100%;
    }

    button:active {
      transform: scale(0.98);
    }

    button:focus-visible {
      outline: 3px solid rgba(var(--outline-primary-rgb), 0.5);
      outline-offset: 3px;
    }

    :host([disabled]) button {
      cursor: default;
      filter: grayscale(0.6);
      opacity: 0.5;
    }

    svg {
      flex: none;
      height: 24px;
      width: 24px;
    }

    .label {
      white-space: nowrap;
    }

    connection-timer {
      font-size: 0.95rem;
      font-weight: 500;
      margin-left: auto;
      opacity: 0.9;
    }

    /* Moving shine while connecting. */
    .shine {
      background: linear-gradient(
        100deg,
        transparent 20%,
        rgba(255, 255, 255, 0.45) 50%,
        transparent 80%
      );
      inset: 0;
      opacity: 0;
      pointer-events: none;
      position: absolute;
      transform: translateX(-100%);
    }

    :host([connection-state='connecting']) .shine,
    :host([connection-state='reconnecting']) .shine {
      animation: shine 1.3s ease-in-out infinite;
      opacity: 1;
    }

    :host([connection-state='connecting']) button,
    :host([connection-state='reconnecting']) button {
      background: linear-gradient(
        135deg,
        rgba(var(--outline-primary-rgb), 0.75),
        var(--accent)
      );
    }

    :host([connection-state='connecting']) svg,
    :host([connection-state='reconnecting']) svg {
      animation: breathe 1.1s ease-in-out infinite;
    }

    /* Connected: outlined, gently glowing, so "Disconnect" reads differently. */
    :host([connection-state='connected']) button {
      animation: glow 3s ease-in-out infinite;
      background: var(--outline-card-background);
      border-color: var(--accent);
      color: var(--accent);
      justify-content: flex-start;
    }

    :host([connection-state='connected']) button.pop {
      animation:
        pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1),
        glow 3s ease-in-out infinite;
    }

    :host([connection-state='disconnecting']) button {
      opacity: 0.7;
    }

    @keyframes shine {
      to {
        transform: translateX(100%);
      }
    }

    @keyframes breathe {
      50% {
        opacity: 0.5;
        transform: scale(0.88);
      }
    }

    @keyframes glow {
      0%,
      100% {
        box-shadow: 0 4px 14px rgba(var(--outline-primary-rgb), 0.18);
      }
      50% {
        box-shadow:
          0 0 0 5px rgba(var(--outline-primary-rgb), 0.14),
          0 6px 22px rgba(var(--outline-primary-rgb), 0.35);
      }
    }

    @keyframes pop {
      0% {
        transform: scale(0.95);
      }
      100% {
        transform: scale(1);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .shine,
      svg,
      button {
        animation: none !important;
      }
    }
  `;

  willUpdate(changed: PropertyValues<this>) {
    const previous = changed.get('connectionState');
    if (
      changed.has('connectionState') &&
      this.connectionState === ServerConnectionState.CONNECTED &&
      (previous === ServerConnectionState.CONNECTING ||
        previous === ServerConnectionState.RECONNECTING)
    ) {
      this.justConnected = true;
      window.clearTimeout(this.popTimer);
      this.popTimer = window.setTimeout(() => {
        this.justConnected = false;
      }, 600);
    }
  }

  render() {
    const up =
      this.connectionState === ServerConnectionState.CONNECTED ||
      this.connectionState === ServerConnectionState.RECONNECTING;
    return html`
      <button
        class=${this.justConnected ? 'pop' : ''}
        ?disabled=${this.disabled}
        aria-label=${this.label}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3v8"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
          <path
            d="M7.05 6.4a7.5 7.5 0 1 0 9.9 0"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
        <span class="label">${this.label}</span>
        ${up
          ? html`<connection-timer
              server-id=${this.serverId}
              connection-state=${this.connectionState}
            ></connection-timer>`
          : ''}
        <span class="shine"></span>
      </button>
    `;
  }
}

// ---------------------------------------------------------------------------
// Fork: bottom bar (status on the left — tap to test —, pill button right).

@customElement('connect-bar')
export class ConnectBar extends LitElement {
  @property({attribute: 'connection-state', reflect: true})
  connectionState: ServerConnectionState = ServerConnectionState.DISCONNECTED;
  @property({attribute: 'server-id'}) serverId = '';
  @property() primary = '';
  @property() secondary = '';
  @property({type: Boolean}) testing = false;
  @property({type: Boolean, reflect: true}) disabled = false;

  static styles = css`
    :host {
      display: block;
      -webkit-tap-highlight-color: transparent;
    }

    .bar {
      align-items: center;
      background: #383a39;
      border-radius: 26px 26px 0 0;
      box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.18);
      box-sizing: border-box;
      display: flex;
      gap: 12px;
      padding: 16px 16px max(16px, env(safe-area-inset-bottom)) 22px;
    }

    .status {
      all: unset;
      cursor: pointer;
      flex: 1;
      font-family: var(--outline-font-family);
      min-width: 0;
    }

    .l1 {
      color: #f2f2f2;
      font-size: 0.95rem;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .l2 {
      align-items: center;
      color: #a8aea9;
      display: flex;
      font-size: 0.78rem;
      gap: 6px;
      margin-top: 3px;
      overflow: hidden;
      white-space: nowrap;
    }

    .testing .l1 {
      animation: blink 1s ease-in-out infinite;
    }

    .pill {
      all: unset;
      align-items: center;
      background: #4a4d4b;
      border: 3px solid #6c706d;
      border-radius: 999px;
      box-sizing: border-box;
      color: #f5f5f5;
      cursor: pointer;
      display: flex;
      flex: none;
      font-family: var(--outline-font-family);
      font-size: 1.15rem;
      height: 60px;
      justify-content: center;
      letter-spacing: 0.01em;
      min-width: 150px;
      padding: 0 26px;
      position: relative;
      transition:
        background 0.3s ease,
        border-color 0.3s ease,
        color 0.3s ease,
        box-shadow 0.3s ease,
        transform 0.15s ease;
      white-space: nowrap;
    }

    .pill:active {
      transform: scale(0.96);
    }

    :host([disabled]) .pill {
      cursor: default;
      opacity: 0.5;
    }

    /* Connected: like the reference, dark fill with a bright ring. */
    :host([connection-state='connected']) .pill {
      background: #11613a;
      border-color: #22a35d;
      box-shadow: 0 0 0 0 rgba(34, 163, 93, 0.5);
      color: #c7f5da;
    }

    :host([connection-state='connecting']) .pill,
    :host([connection-state='reconnecting']) .pill {
      animation: ring 1.2s ease-out infinite;
      background: #1d4a33;
      border-color: #22a35d;
      color: #c7f5da;
    }

    :host([connection-state='disconnecting']) .pill {
      opacity: 0.7;
    }

    @keyframes ring {
      0% {
        box-shadow: 0 0 0 0 rgba(34, 163, 93, 0.55);
      }
      100% {
        box-shadow: 0 0 0 12px rgba(34, 163, 93, 0);
      }
    }

    @keyframes blink {
      50% {
        opacity: 0.45;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .pill,
      .l1 {
        animation: none !important;
      }
    }
  `;

  private get pillLabel(): string {
    // English on purpose (as requested), like other VPN clients.
    switch (this.connectionState) {
      case ServerConnectionState.CONNECTING:
        return 'Connecting…';
      case ServerConnectionState.CONNECTED:
        return 'Connected';
      case ServerConnectionState.RECONNECTING:
        return 'Reconnecting…';
      case ServerConnectionState.DISCONNECTING:
        return 'Disconnecting…';
      default:
        return 'Connect';
    }
  }

  render() {
    const up =
      this.connectionState === ServerConnectionState.CONNECTED ||
      this.connectionState === ServerConnectionState.RECONNECTING;
    return html`
      <div class="bar">
        <button
          class="status ${this.testing ? 'testing' : ''}"
          @click=${() => this.fire('status-tap')}
        >
          <div class="l1">${this.primary}</div>
          <div class="l2">
            <span>${this.secondary}</span>
            ${up
              ? html`<span>·</span
                  ><connection-timer
                    server-id=${this.serverId}
                    connection-state=${this.connectionState}
                  ></connection-timer>`
              : ''}
          </div>
        </button>
        <button
          class="pill"
          ?disabled=${this.disabled}
          @click=${() => !this.disabled && this.fire('connect-toggle')}
        >
          ${this.pillLabel}
        </button>
      </div>
    `;
  }

  private fire(type: string) {
    this.dispatchEvent(new CustomEvent(type, {bubbles: true, composed: true}));
  }
}
