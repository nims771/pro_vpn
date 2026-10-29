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

package outline

import (
	"encoding/binary"
	"errors"
	"syscall"

	"golang.org/x/sys/windows"
)

// ipUnicastIf forces outgoing IPv4 packets through one adapter (ws2ipdef.h).
const ipUnicastIf = 31

// bindToInterface makes sockets leave through adapter `index` (in network byte
// order, as IP_UNICAST_IF wants), whatever the routing table says.
func bindToInterface(index int) func(network, address string, conn syscall.RawConn) error {
	bytes := make([]byte, 4)
	binary.NativeEndian.PutUint32(bytes, uint32(index))
	bigEndian := int(binary.BigEndian.Uint32(bytes))
	return func(network, address string, conn syscall.RawConn) error {
		var operr error
		err := conn.Control(func(fd uintptr) {
			operr = windows.SetsockoptInt(windows.Handle(fd), syscall.IPPROTO_IP, ipUnicastIf, bigEndian)
		})
		return errors.Join(err, operr)
	}
}
