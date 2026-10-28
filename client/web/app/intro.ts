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

// Fork: short animated intro shown while the app starts. It continues the
// native splash (same white background and logo), then fades away.

import introLogo from '../assets/intro-logo.png';

const TOTAL_MS = 1900;
const REDUCED_MS = 700;

let introDone: Promise<void> = Promise.resolve();

/** Resolves when the intro has faded out (immediately if none is shown). */
export function whenIntroDone(): Promise<void> {
  return introDone;
}

export function showIntro(appName: string): void {
  if (document.getElementById('proclient-intro')) return;
  const reduced = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  const style = document.createElement('style');
  style.textContent = `
    #proclient-intro {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 22px; background: #fff;
      transition: opacity .4s ease, visibility .4s ease;
    }
    #proclient-intro.done { opacity: 0; visibility: hidden; }
    #proclient-intro img {
      width: min(64vw, 300px); height: auto;
      animation: pi-in .7s cubic-bezier(.2,.9,.3,1.2) both;
    }
    #proclient-intro .pi-name {
      font: 700 26px/1 var(--outline-font-family, 'Roboto', sans-serif);
      letter-spacing: .02em; color: var(--outline-primary, #16a34a);
      animation: pi-up .5s ease .35s both;
    }
    #proclient-intro .pi-bar {
      width: 120px; height: 4px; border-radius: 4px; overflow: hidden;
      background: rgba(var(--outline-primary-rgb, 22,163,74), .15);
      animation: pi-up .4s ease .5s both;
    }
    #proclient-intro .pi-bar::after {
      content: ''; display: block; height: 100%; width: 100%;
      background: var(--outline-primary, #16a34a); border-radius: inherit;
      transform-origin: left; animation: pi-fill 1s ease .55s both;
    }
    @keyframes pi-in { from { opacity: 0; transform: scale(.86); } to { opacity: 1; transform: none; } }
    @keyframes pi-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes pi-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) {
      #proclient-intro * { animation: none !important; }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'proclient-intro';
  overlay.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.src = introLogo;
  img.alt = '';
  const name = document.createElement('div');
  name.className = 'pi-name';
  name.textContent = appName;
  const bar = document.createElement('div');
  bar.className = 'pi-bar';
  overlay.append(img, name, bar);

  const mount = () => document.body.appendChild(overlay);
  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, {once: true});
  }

  introDone = new Promise(resolve => {
    window.setTimeout(
      () => {
        overlay.classList.add('done');
        window.setTimeout(() => {
          overlay.remove();
          style.remove();
          resolve();
        }, 450);
      },
      reduced ? REDUCED_MS : TOTAL_MS
    );
  });
}
