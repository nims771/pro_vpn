/**
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {PluginListenerHandle} from '@capacitor/core';

export interface CapacitorPluginOutline {
  invokeMethod(options: {
    method: string;
    input: string;
  }): Promise<{value: string}>;
  start(options: {
    tunnelId: string;
    serverName: string;
    transportConfig: string;
  }): Promise<void>;
  stop(options: {tunnelId: string}): Promise<void>;
  isRunning(options: {tunnelId: string}): Promise<{isRunning: boolean}>;
  /** Fork: bytes relayed through the tunnel since the VPN process started. */
  getTrafficStats(): Promise<{rxBytes: number; txBytes: number}>;
  /** Fork: time of an HTTP request through the server, -1 on failure. */
  measureLatency(): Promise<{ms: number}>;
  /** Fork: opens the system VPN settings (always-on, kill switch). */
  openVpnSettings(): Promise<void>;
  /** Fork: device identity for the HWID. */
  getDeviceInfo(): Promise<{
    deviceId: string;
    manufacturer: string;
    model: string;
    os: string;
    osVersion: string;
  }>;
  initializeErrorReporting(options: {apiKey: string}): Promise<void>;
  reportEvents(options: {uuid: string}): Promise<void>;
  /**
   * Reads the localStorage written by the Cordova build under its file://
   * origin, which Capacitor's https://localhost origin cannot see. Android only.
   *
   * Resolves with the legacy key/value pairs. An empty object means the origin
   * was read and held nothing, which completes the migration — it is not a
   * failure. Rejects when the origin could not be read at all, in which case
   * nothing is known about it and the caller should retry on a later launch.
   */
  getLegacyCordovaLocalStorage(): Promise<Record<string, string>>;
  quitApplication(): Promise<void>;
  addListener(
    eventName: string,
    listenerFunc: (data: {id: string; status: number}) => void
  ): Promise<PluginListenerHandle>;
}
