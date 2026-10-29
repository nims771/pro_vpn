// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Fork: the app's accent color (header, buttons, highlights), chosen in
// Settings. Every themed style reads the --outline-primary* variables, so
// changing them on <html> recolors the whole app at once.

export interface Accent {
  id: string;
  /** Main color: buttons, selection, progress. */
  color: string;
  /** Darker shade: header and side menu. */
  header: string;
}

export const ACCENTS: Accent[] = [
  {id: 'green', color: '#16A34A', header: '#166534'},
  {id: 'emerald', color: '#059669', header: '#064E3B'},
  {id: 'teal', color: '#0D9488', header: '#134E4A'},
  {id: 'cyan', color: '#0891B2', header: '#164E63'},
  {id: 'blue', color: '#2563EB', header: '#1E3A8A'},
  {id: 'indigo', color: '#4F46E5', header: '#312E81'},
  {id: 'purple', color: '#9333EA', header: '#581C87'},
  {id: 'pink', color: '#DB2777', header: '#831843'},
  {id: 'red', color: '#DC2626', header: '#7F1D1D'},
  {id: 'orange', color: '#EA580C', header: '#7C2D12'},
  {id: 'amber', color: '#D97706', header: '#78350F'},
  {id: 'graphite', color: '#475569', header: '#1E293B'},
];

export const DEFAULT_ACCENT = ACCENTS[0];

const STORAGE_KEY = 'proclient.accent';

type Listener = (accent: Accent) => void;
const listeners = new Set<Listener>();

let current: Accent = load();

export function getAccent(): Accent {
  return current;
}

export function onAccentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Picks a preset or a custom color ("#RRGGBB"); saved for next launches. */
export function setAccent(colorOrId: string) {
  const preset = ACCENTS.find(a => a.id === colorOrId || a.color === colorOrId);
  const accent = preset ?? customAccent(colorOrId);
  if (!accent) return;
  current = accent;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accent));
  } catch {
    // Not saved; still applied for this session.
  }
  applyAccent(accent);
  for (const listener of listeners) listener(accent);
}

/** Applies the saved accent; call once at startup. */
export function applySavedAccent() {
  applyAccent(current);
}

function load(): Accent {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && isHex(saved.color) && isHex(saved.header)) {
      return {id: String(saved.id || 'custom'), ...saved};
    }
  } catch {
    // Fall through.
  }
  return DEFAULT_ACCENT;
}

function customAccent(color: string): Accent | undefined {
  if (!isHex(color)) return undefined;
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  const header = hslToHex(h, Math.min(s, 0.85), Math.max(0.14, l * 0.55));
  return {id: 'custom', color: color.toUpperCase(), header};
}

function applyAccent(accent: Accent) {
  const root = document.documentElement.style;
  const rgb = hexToRgb(accent.color);
  const [h, s, l] = rgbToHsl(rgb);
  const hsl = (light: number, sat = s) =>
    `hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(light * 100)}%)`;
  root.setProperty('--outline-primary', accent.color);
  root.setProperty('--outline-primary-rgb', rgb.join(', '));
  root.setProperty('--outline-primary-dark', hsl(Math.max(0.12, l * 0.55)));
  root.setProperty('--outline-primary-medium', hsl(Math.min(0.85, l + 0.36)));
  root.setProperty('--outline-primary-light', hsl(0.92));
  root.setProperty('--outline-dark-primary', accent.header);
  root.setProperty('--mdc-theme-primary', accent.color);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', accent.header);
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}
