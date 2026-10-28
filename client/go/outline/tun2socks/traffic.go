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

package tun2socks

import (
	"io"
	"sync/atomic"
)

// Bytes relayed through the tunnel since this process started. They keep
// counting across reconnects; the app takes a baseline to show per-session
// numbers.
var (
	uploadBytes   atomic.Int64
	downloadBytes atomic.Int64
)

// TotalUploadBytes returns how many bytes the device sent through the tunnel.
func TotalUploadBytes() int64 {
	return uploadBytes.Load()
}

// TotalDownloadBytes returns how many bytes the device received through the tunnel.
func TotalDownloadBytes() int64 {
	return downloadBytes.Load()
}

// countingReader counts bytes read from the TUN device (device -> server).
type countingReader struct {
	r io.Reader
	n *atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	if n > 0 {
		c.n.Add(int64(n))
	}
	return n, err
}

// countingWriteCloser counts bytes written to the TUN device (server -> device).
type countingWriteCloser struct {
	w io.WriteCloser
	n *atomic.Int64
}

func (c *countingWriteCloser) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	if n > 0 {
		c.n.Add(int64(n))
	}
	return n, err
}

func (c *countingWriteCloser) Close() error {
	return c.w.Close()
}
