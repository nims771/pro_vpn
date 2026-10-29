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

//go:build windows

package xraytransport

import (
	"encoding/binary"
	"syscall"

	"github.com/xtls/xray-core/transport/internet"
	"golang.org/x/sys/windows"
)

const (
	ipUnicastIf   = 31 // IPPROTO_IP, interface index in network byte order
	ipv6UnicastIf = 31 // IPPROTO_IPV6, interface index in host byte order
)

// BindToInterface makes every socket Xray opens leave through the physical
// adapter `index`, so its traffic to the server doesn't loop back into the VPN.
func BindToInterface(index int) error {
	if index <= 0 {
		return nil
	}
	bytes := make([]byte, 4)
	binary.NativeEndian.PutUint32(bytes, uint32(index))
	bigEndian := int(binary.BigEndian.Uint32(bytes))
	return internet.RegisterDialerController(func(network, address string, conn syscall.RawConn) error {
		return conn.Control(func(fd uintptr) {
			handle := windows.Handle(fd)
			// One of the two applies, depending on the socket family.
			_ = windows.SetsockoptInt(handle, syscall.IPPROTO_IP, ipUnicastIf, bigEndian)
			_ = windows.SetsockoptInt(handle, syscall.IPPROTO_IPV6, ipv6UnicastIf, index)
		})
	})
}
