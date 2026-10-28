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

// Fork: TCP ping of servers through the native backend.

import {proclientStore} from './store';
import {getDefaultMethodChannel} from '../method_channel';

async function measure(addresses: string[]): Promise<Record<string, number>> {
  const raw = await getDefaultMethodChannel().invokeMethod(
    'PingServers',
    JSON.stringify(addresses)
  );
  return JSON.parse(raw);
}

export function pingServers(
  servers: Array<{id: string; address: string}>
): Promise<void> {
  return proclientStore.pingServers(servers, measure);
}

/** Re-pings one server (tap on its ping); returns ms, null if no answer. */
export function pingServer(server: {
  id: string;
  address: string;
}): Promise<number | null | undefined> {
  return proclientStore.pingOne(server, measure);
}
