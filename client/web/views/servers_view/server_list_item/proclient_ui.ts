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
