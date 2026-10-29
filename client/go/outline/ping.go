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

package outline

import (
	"encoding/json"
	"net"
	"sync"
	"time"

	"localhost/client/go/outline/platerrors"
)

const (
	pingTimeout     = 3 * time.Second
	pingConcurrency = 16
)

// pingServers measures the TCP connect time to each "host:port" in the JSON
// array `input`. It returns a JSON object mapping each address to its latency in
// milliseconds, or -1 when the server could not be reached within pingTimeout.
//
// On Android the app itself is excluded from the VPN, so this measures the direct
// path to each server even while connected.
func pingServers(input string) (string, error) {
	var addresses []string
	if err := json.Unmarshal([]byte(input), &addresses); err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "ping input must be a JSON array of host:port",
			Cause:   platerrors.ToPlatformError(err),
		}
	}

	results := make(map[string]int64, len(addresses))
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, pingConcurrency)
	for _, address := range addresses {
		if _, seen := results[address]; seen {
			continue
		}
		results[address] = -1
		wg.Add(1)
		go func(address string) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			ms := pingOne(address)
			mu.Lock()
			results[address] = ms
			mu.Unlock()
		}(address)
	}
	wg.Wait()

	out, err := json.Marshal(results)
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.InternalError,
			Message: "failed to encode ping results",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	return string(out), nil
}

func pingOne(address string) int64 {
	// Fork: on Windows while connected, measure the direct path, not the tunnel.
	dialer := newBypassDialer(pingTimeout)
	if dialer == nil {
		dialer = &net.Dialer{Timeout: pingTimeout}
	}
	start := time.Now()
	conn, err := dialer.Dial("tcp", address)
	if err != nil {
		return -1
	}
	elapsed := time.Since(start)
	conn.Close()
	ms := elapsed.Milliseconds()
	if ms < 1 {
		ms = 1
	}
	return ms
}
