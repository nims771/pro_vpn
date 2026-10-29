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

// Fork: let the app reach its subscription panel (and measure pings) outside
// the VPN while it is connected. That is what keeps a blocked server fixable:
// the tunnel is dead, but the panel can still be asked for the new address.
//
// Android excludes the whole app from the VPN, so nothing is needed there. On
// Windows all traffic is routed into the TAP adapter, so while connected the
// app tells us the physical adapter (SetBypassInterface) and we bind sockets to
// it. Name lookups then can't use the system DNS (it points into the tunnel and
// plain DNS on other adapters is blocked against leaks), so they go over
// DNS-over-TLS on the physical adapter, with a cache of earlier answers as the
// last resort.

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"localhost/client/go/outline/platerrors"
)

// bypassInterface is the index of the physical network adapter; 0 = no bypass.
var bypassInterface atomic.Int32

// MethodSetBypassInterface: input is the adapter index ("" or "0" to clear).
const MethodSetBypassInterface = "SetBypassInterface"

func setBypassInterface(input string) error {
	input = strings.TrimSpace(input)
	if input == "" {
		bypassInterface.Store(0)
		return nil
	}
	index, err := strconv.Atoi(input)
	if err != nil || index < 0 {
		return platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "adapter index must be a non-negative number",
		}
	}
	bypassInterface.Store(int32(index))
	return nil
}

// dnsOverTLS servers, tried in order when a name must be resolved outside the VPN.
var dnsOverTLS = []struct{ address, name string }{
	{"1.1.1.1:853", "one.one.one.one"},
	{"8.8.8.8:853", "dns.google"},
	{"77.88.8.8:853", "common.dot.dns.yandex.net"},
	{"9.9.9.9:853", "dns.quad9.net"},
}

// Answers seen earlier, so a host stays reachable even if every resolver fails.
var (
	resolvedMu    sync.Mutex
	resolvedHosts = map[string][]string{}
)

func rememberHost(host string, ips []string) {
	if len(ips) == 0 {
		return
	}
	resolvedMu.Lock()
	resolvedHosts[strings.ToLower(host)] = ips
	resolvedMu.Unlock()
}

func rememberedHost(host string) []string {
	resolvedMu.Lock()
	defer resolvedMu.Unlock()
	return resolvedHosts[strings.ToLower(host)]
}

// newBypassDialer returns a dialer bound to the physical adapter, or nil when
// there is nothing to bypass (not connected, or not supported on this OS).
func newBypassDialer(timeout time.Duration) *net.Dialer {
	index := int(bypassInterface.Load())
	if index <= 0 {
		return nil
	}
	control := bindToInterface(index)
	if control == nil {
		return nil
	}
	return &net.Dialer{Timeout: timeout, Control: control}
}

// resolveOutsideVPN finds IPv4 addresses for host without relying on the VPN:
// all DNS-over-TLS servers are asked at once and the first answer wins.
func resolveOutsideVPN(ctx context.Context, host string, dialer *net.Dialer) ([]string, error) {
	if ip := net.ParseIP(host); ip != nil {
		return []string{ip.String()}, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	type answer struct {
		ips []string
		err error
	}
	answers := make(chan answer, len(dnsOverTLS))
	for _, server := range dnsOverTLS {
		server := server
		go func() {
			r := &net.Resolver{
				PreferGo: true,
				Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
					conn, err := dialer.DialContext(ctx, "tcp4", server.address)
					if err != nil {
						return nil, err
					}
					// Not a PacketConn, so the resolver uses DNS-over-TCP framing.
					return tls.Client(conn, &tls.Config{ServerName: server.name}), nil
				},
			}
			addrs, err := r.LookupIP(lookupCtx, "ip4", host)
			ips := make([]string, 0, len(addrs))
			for _, a := range addrs {
				ips = append(ips, a.String())
			}
			if err == nil && len(ips) == 0 {
				err = errors.New("no IPv4 address")
			}
			answers <- answer{ips, err}
		}()
	}
	var errs []error
	for range dnsOverTLS {
		a := <-answers
		if a.err == nil {
			rememberHost(host, a.ips)
			return a.ips, nil
		}
		errs = append(errs, a.err)
	}
	if ips := rememberedHost(host); len(ips) > 0 {
		return ips, nil
	}
	return nil, errors.Join(errs...)
}

// bypassHTTPClient is an HTTP client whose connections leave through the
// physical adapter, or nil when no bypass is active.
func bypassHTTPClient(timeout time.Duration) *http.Client {
	dialer := newBypassDialer(8 * time.Second)
	if dialer == nil {
		return nil
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := resolveOutsideVPN(ctx, host, dialer)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, ip := range ips {
				conn, err := dialer.DialContext(ctx, "tcp4", net.JoinHostPort(ip, port))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		DisableKeepAlives:     true,
	}
	return &http.Client{Timeout: timeout, Transport: transport}
}

// rememberingHTTPClient is the regular client; it records the addresses it
// resolves so the bypass path can fall back on them later.
func rememberingHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, network, address)
		if err == nil {
			if host, _, splitErr := net.SplitHostPort(address); splitErr == nil && net.ParseIP(host) == nil {
				if remote, ok := conn.RemoteAddr().(*net.TCPAddr); ok && remote.IP.To4() != nil {
					rememberHost(host, []string{remote.IP.String()})
				}
			}
		}
		return conn, err
	}
	return &http.Client{Timeout: timeout, Transport: transport}
}

// doOutsideVPNFirst sends a GET request outside the VPN when it can (so it
// works even if the VPN server is blocked), then the normal way.
func doOutsideVPNFirst(req *http.Request, timeout time.Duration) (*http.Response, error) {
	var errs []error
	if client := bypassHTTPClient(timeout); client != nil {
		resp, err := client.Do(req.Clone(req.Context()))
		if err == nil {
			return resp, nil
		}
		errs = append(errs, err)
	}
	resp, err := rememberingHTTPClient(timeout).Do(req.Clone(req.Context()))
	if err == nil {
		return resp, nil
	}
	errs = append(errs, err)
	return nil, errors.Join(errs...)
}
