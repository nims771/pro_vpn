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

package xraytransport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/core"
	xtls "github.com/xtls/xray-core/transport/internet/tls"
	"golang.getoutline.org/sdk/transport"

	"github.com/xtls/xray-core/app/proxyman"
	confserial "github.com/xtls/xray-core/infra/conf/serial"

	// Features every instance needs (they register themselves).
	_ "github.com/xtls/xray-core/app/dispatcher"
	_ "github.com/xtls/xray-core/app/log"
	_ "github.com/xtls/xray-core/app/policy"
	_ "github.com/xtls/xray-core/app/proxyman/inbound"
	_ "github.com/xtls/xray-core/app/proxyman/outbound"
)

// Transport is one server reached through Xray. The Xray instance starts on
// first use, so parsing a key (to show it in the app) costs nothing.
type Transport struct {
	link     string
	parsed   *parsedLink
	FirstHop string
	Name     string
}

// New parses a share link and checks that Xray accepts the resulting config.
func New(link string) (*Transport, error) {
	parsed, err := parseLink(link)
	if err != nil {
		return nil, err
	}
	if _, err := buildConfig(parsed, parsed.srv.host); err != nil {
		return nil, err
	}
	return &Transport{link: link, parsed: parsed, FirstHop: parsed.FirstHop, Name: parsed.Name}, nil
}

var _ transport.StreamDialer = (*Transport)(nil)
var _ transport.PacketListener = (*Transport)(nil)

// DialStream implements transport.StreamDialer.
func (t *Transport) DialStream(ctx context.Context, address string) (transport.StreamConn, error) {
	inst, err := t.instance(ctx)
	if err != nil {
		return nil, err
	}
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return nil, err
	}
	dest := xnet.TCPDestination(xnet.ParseAddress(host), xnet.Port(port))
	// The connection outlives the dial: don't tie it to the caller's context.
	conn, err := core.Dial(context.Background(), inst, dest)
	if err != nil {
		return nil, err
	}
	return &streamConn{Conn: conn}, nil
}

// ListenPacket implements transport.PacketListener.
func (t *Transport) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	inst, err := t.instance(ctx)
	if err != nil {
		return nil, err
	}
	pc, err := core.DialUDP(context.Background(), inst)
	if err != nil {
		return nil, err
	}
	return newDeadlinePacketConn(pc), nil
}

// ---- One running Xray instance at a time ----

var (
	activeMu   sync.Mutex
	activeLink string
	activeInst *core.Instance
)

func (t *Transport) instance(ctx context.Context) (*core.Instance, error) {
	activeMu.Lock()
	defer activeMu.Unlock()
	if activeInst != nil && activeLink == t.link {
		return activeInst, nil
	}
	if activeInst != nil {
		activeInst.Close()
		activeInst, activeLink = nil, ""
	}
	dialHost := t.parsed.srv.host
	if resolve := currentResolver(); resolve != nil && net.ParseIP(dialHost) == nil {
		// Windows: the system DNS points into the VPN, which is us.
		if ips, err := resolve(ctx, dialHost); err == nil && len(ips) > 0 {
			dialHost = ips[0]
		} else {
			slog.Warn("xray: could not resolve the server outside the VPN", "err", err)
		}
	}
	config, err := buildConfig(t.parsed, dialHost)
	if err != nil {
		return nil, err
	}
	inst, err := core.New(config)
	if err != nil {
		return nil, fmt.Errorf("xray: %w", err)
	}
	if err := inst.Start(); err != nil {
		inst.Close()
		return nil, fmt.Errorf("xray: %w", err)
	}
	activeInst, activeLink = inst, t.link
	return inst, nil
}

func buildConfig(parsed *parsedLink, dialHost string) (*core.Config, error) {
	outbound, insecure, err := parsed.outbound(dialHost)
	if err != nil {
		return nil, err
	}
	logLevel := "warning"
	if os.Getenv("PROVPN_XRAY_DEBUG") != "" {
		logLevel = "debug"
	}
	doc := map[string]any{
		"log":       map[string]any{"loglevel": logLevel, "access": "none"},
		"outbounds": []any{outbound},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	jsonConfig, err := confserial.DecodeJSONConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("xray config: %w", err)
	}
	config, err := jsonConfig.Build()
	if err != nil {
		return nil, fmt.Errorf("xray config: %w", err)
	}
	if insecure {
		// Xray no longer accepts "allowInsecure" in JSON, but panels still hand
		// out links for self-signed servers; honor the link's choice.
		if err := allowInsecure(config); err != nil {
			return nil, err
		}
	}
	return config, nil
}

func allowInsecure(config *core.Config) error {
	for _, handler := range config.Outbound {
		if handler.SenderSettings == nil {
			continue
		}
		msg, err := handler.SenderSettings.GetInstance()
		if err != nil {
			return err
		}
		sender, ok := msg.(*proxyman.SenderConfig)
		if !ok || sender.StreamSettings == nil {
			continue
		}
		changed := false
		for i, security := range sender.StreamSettings.SecuritySettings {
			inst, err := security.GetInstance()
			if err != nil {
				return err
			}
			if tlsConfig, ok := inst.(*xtls.Config); ok {
				tlsConfig.AllowInsecure = true
				sender.StreamSettings.SecuritySettings[i] = serial.ToTypedMessage(tlsConfig)
				changed = true
			}
		}
		if changed {
			handler.SenderSettings = serial.ToTypedMessage(sender)
		}
	}
	return nil
}

// ---- Resolving the server outside the VPN (Windows) ----

// Resolver finds IPv4 addresses for a host without using the VPN.
type Resolver func(ctx context.Context, host string) ([]string, error)

var (
	resolverMu sync.Mutex
	resolver   Resolver
)

// SetResolver is used where the system DNS goes through the VPN (Windows).
func SetResolver(r Resolver) {
	resolverMu.Lock()
	resolver = r
	resolverMu.Unlock()
}

func currentResolver() Resolver {
	resolverMu.Lock()
	defer resolverMu.Unlock()
	return resolver
}

// ---- Connection wrappers ----

// streamConn adapts Xray's net.Conn to transport.StreamConn. Xray has no
// half-close for these connections, so CloseRead/CloseWrite are no-ops and
// the connection ends with Close (or when the server closes it).
type streamConn struct {
	net.Conn
}

func (c *streamConn) CloseRead() error  { return nil }
func (c *streamConn) CloseWrite() error { return nil }

// deadlinePacketConn adds read deadlines to Xray's UDP PacketConn (which
// ignores them), so idle UDP sessions and checks time out as expected.
type deadlinePacketConn struct {
	net.PacketConn
	packets chan packet
	done    chan struct{}
	once    sync.Once

	mu       sync.Mutex
	deadline time.Time
	changed  chan struct{}
}

type packet struct {
	data []byte
	addr net.Addr
	err  error
}

func newDeadlinePacketConn(pc net.PacketConn) *deadlinePacketConn {
	c := &deadlinePacketConn{
		PacketConn: pc,
		packets:    make(chan packet, 64),
		done:       make(chan struct{}),
		changed:    make(chan struct{}),
	}
	go c.pump()
	return c
}

func (c *deadlinePacketConn) pump() {
	buf := make([]byte, 65535)
	for {
		n, addr, err := c.PacketConn.ReadFrom(buf)
		p := packet{addr: addr, err: err}
		if n > 0 {
			p.data = append([]byte(nil), buf[:n]...)
		}
		select {
		case c.packets <- p:
		case <-c.done:
			return
		}
		if err != nil {
			return
		}
	}
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func (c *deadlinePacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	for {
		c.mu.Lock()
		deadline, changed := c.deadline, c.changed
		c.mu.Unlock()
		var timer *time.Timer
		var expired <-chan time.Time
		if !deadline.IsZero() {
			wait := time.Until(deadline)
			if wait <= 0 {
				return 0, nil, timeoutError{}
			}
			timer = time.NewTimer(wait)
			expired = timer.C
		}
		select {
		case pkt := <-c.packets:
			stopTimer(timer)
			if pkt.err != nil {
				return 0, nil, pkt.err
			}
			return copy(p, pkt.data), pkt.addr, nil
		case <-c.done:
			stopTimer(timer)
			return 0, nil, io.EOF
		case <-expired:
			return 0, nil, timeoutError{}
		case <-changed:
			// The deadline moved: wait again with the new one.
			stopTimer(timer)
		}
	}
}

func stopTimer(t *time.Timer) {
	if t != nil {
		t.Stop()
	}
}

func (c *deadlinePacketConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	c.deadline = t
	close(c.changed)
	c.changed = make(chan struct{})
	c.mu.Unlock()
	return nil
}

func (c *deadlinePacketConn) SetDeadline(t time.Time) error {
	return c.SetReadDeadline(t)
}

func (c *deadlinePacketConn) Close() error {
	c.once.Do(func() { close(c.done) })
	return c.PacketConn.Close()
}
