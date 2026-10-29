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

// Package xraytransport lets the app use Xray-core protocols (VLESS with
// REALITY / Vision, VMess, Trojan, Shadowsocks 2022, Hysteria2, WireGuard)
// over every Xray transport (RAW/TCP, WebSocket, gRPC, HTTPUpgrade, XHTTP,
// mKCP). It turns the usual share links (vless://, vmess://, ...) into an Xray
// outbound and exposes it as an Outline StreamDialer / PacketListener.
package xraytransport

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// IsXrayLink reports whether the access key must be handled by Xray rather
// than by Outline's own Shadowsocks implementation.
func IsXrayLink(link string) bool {
	link = strings.TrimSpace(link)
	scheme, _, ok := strings.Cut(link, "://")
	if !ok {
		return false
	}
	switch strings.ToLower(scheme) {
	case "vless", "vmess", "trojan", "hysteria2", "hy2", "wireguard", "wg":
		return true
	case "ss":
		// Classic Shadowsocks stays with Outline; 2022 ciphers and links with
		// an Xray transport (type=ws, security=tls, ...) need Xray.
		l, err := splitLink(link)
		if err != nil {
			return false
		}
		method, _, err := shadowsocksCredentials(l)
		if err == nil && strings.HasPrefix(strings.ToLower(method), "2022-") {
			return true
		}
		return l.query.Get("type") != "" || l.query.Get("security") != ""
	}
	return false
}

// shareLink is a share link split into its parts, leniently (ports such as
// "443,20000-30000" or unescaped characters that net/url would reject).
type shareLink struct {
	scheme string
	user   string
	host   string
	port   string
	path   string
	query  url.Values
	name   string
}

func splitLink(link string) (*shareLink, error) {
	link = strings.TrimSpace(link)
	scheme, rest, ok := strings.Cut(link, "://")
	if !ok {
		return nil, errors.New("not a link")
	}
	l := &shareLink{scheme: strings.ToLower(scheme), query: url.Values{}}
	if before, fragment, found := strings.Cut(rest, "#"); found {
		rest = before
		if name, err := url.PathUnescape(fragment); err == nil {
			l.name = name
		} else {
			l.name = fragment
		}
	}
	if before, rawQuery, found := strings.Cut(rest, "?"); found {
		rest = before
		l.query, _ = url.ParseQuery(rawQuery)
	}
	if before, path, found := strings.Cut(rest, "/"); found {
		rest = before
		l.path = "/" + path
	}
	if at := strings.LastIndex(rest, "@"); at >= 0 {
		user := rest[:at]
		if decoded, err := url.PathUnescape(user); err == nil {
			user = decoded
		}
		l.user = user
		rest = rest[at+1:]
	}
	if strings.HasPrefix(rest, "[") {
		end := strings.Index(rest, "]")
		if end < 0 {
			return nil, errors.New("bad IPv6 address")
		}
		l.host = rest[1:end]
		l.port = strings.TrimPrefix(rest[end+1:], ":")
	} else if colon := strings.LastIndex(rest, ":"); colon >= 0 {
		l.host, l.port = rest[:colon], rest[colon+1:]
	} else {
		l.host = rest
	}
	if l.host == "" {
		return nil, errors.New("server address is missing")
	}
	return l, nil
}

// firstPort returns the first port of a spec like "443" or "443,20000-30000".
func firstPort(spec string) (int, error) {
	spec = strings.TrimSpace(spec)
	first := strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == '-' })
	if len(first) == 0 {
		return 0, errors.New("server port is missing")
	}
	port, err := strconv.Atoi(strings.TrimSpace(first[0]))
	if err != nil || port <= 0 || port > 65535 {
		return 0, fmt.Errorf("bad server port %q", spec)
	}
	return port, nil
}

func isTrue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true
	}
	return false
}

func splitList(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func decodeBase64(text string) ([]byte, error) {
	text = strings.TrimSpace(text)
	text = strings.TrimRight(text, "=")
	for _, enc := range []*base64.Encoding{base64.RawStdEncoding, base64.RawURLEncoding} {
		if data, err := enc.DecodeString(text); err == nil {
			return data, nil
		}
	}
	return nil, errors.New("not base64")
}

// server describes the endpoint and how to reach it.
type server struct {
	protocol string
	host     string // as written in the link (domain or IP)
	port     int
	portSpec string // full port spec, for Hysteria2 port hopping
	params   func(string) string
	auth     string // Hysteria2 password (the user part of the link)
	settings func(dialHost string) map[string]any
	// Defaults applied by the protocol (Trojan is always TLS).
	defaultSecurity string
}

// parsedLink is a share link turned into what Xray needs.
type parsedLink struct {
	srv      *server
	Name     string
	FirstHop string
}

func parseLink(link string) (*parsedLink, error) {
	link = strings.TrimSpace(link)
	scheme, rest, _ := strings.Cut(link, "://")
	scheme = strings.ToLower(scheme)
	if scheme == "vmess" && !strings.Contains(strings.SplitN(rest, "#", 2)[0], "@") {
		return parseVMessJSON(rest)
	}
	l, err := splitLink(link)
	if err != nil {
		return nil, err
	}
	port, err := firstPort(l.port)
	if err != nil {
		return nil, err
	}
	srv := &server{host: l.host, port: port, portSpec: l.port, params: l.query.Get}
	switch scheme {
	case "vless":
		if l.user == "" {
			return nil, errors.New("VLESS link has no user id")
		}
		encryption := l.query.Get("encryption")
		if encryption == "" {
			encryption = "none"
		}
		srv.protocol = "vless"
		srv.settings = func(dialHost string) map[string]any {
			user := map[string]any{"id": l.user, "encryption": encryption}
			if flow := l.query.Get("flow"); flow != "" {
				user["flow"] = flow
			}
			return map[string]any{"vnext": []any{map[string]any{
				"address": dialHost, "port": port, "users": []any{user},
			}}}
		}
	case "vmess":
		if l.user == "" {
			return nil, errors.New("VMess link has no user id")
		}
		alterID, _ := strconv.Atoi(l.query.Get("alterId"))
		security := l.query.Get("encryption")
		if security == "" {
			security = "auto"
		}
		srv.protocol = "vmess"
		srv.settings = func(dialHost string) map[string]any {
			return map[string]any{"vnext": []any{map[string]any{
				"address": dialHost, "port": port,
				"users": []any{map[string]any{"id": l.user, "alterId": alterID, "security": security}},
			}}}
		}
	case "trojan":
		if l.user == "" {
			return nil, errors.New("Trojan link has no password")
		}
		srv.protocol = "trojan"
		srv.defaultSecurity = "tls"
		srv.settings = func(dialHost string) map[string]any {
			return map[string]any{"servers": []any{map[string]any{
				"address": dialHost, "port": port, "password": l.user,
			}}}
		}
	case "ss":
		method, password, err := shadowsocksCredentials(l)
		if err != nil {
			return nil, err
		}
		srv.protocol = "shadowsocks"
		srv.settings = func(dialHost string) map[string]any {
			return map[string]any{"servers": []any{map[string]any{
				"address": dialHost, "port": port, "method": method, "password": password,
			}}}
		}
	case "hysteria2", "hy2":
		srv.protocol = "hysteria"
		srv.auth = l.user
		srv.settings = func(dialHost string) map[string]any {
			return map[string]any{"version": 2, "address": dialHost, "port": port}
		}
	case "wireguard", "wg":
		return parseWireGuard(l, port)
	default:
		return nil, fmt.Errorf("unsupported link type %q", scheme)
	}
	return &parsedLink{srv: srv, Name: l.name, FirstHop: net.JoinHostPort(l.host, strconv.Itoa(port))}, nil
}

func shadowsocksCredentials(l *shareLink) (method, password string, err error) {
	user := l.user
	if !strings.Contains(user, ":") {
		decoded, decodeErr := decodeBase64(user)
		if decodeErr != nil {
			return "", "", errors.New("bad Shadowsocks credentials")
		}
		user = string(decoded)
	}
	method, password, ok := strings.Cut(user, ":")
	if !ok || method == "" {
		return "", "", errors.New("bad Shadowsocks credentials")
	}
	return method, password, nil
}

// parseVMessJSON reads the classic v2rayN "vmess://<base64 JSON>" link.
func parseVMessJSON(encoded string) (*parsedLink, error) {
	encoded, _, _ = strings.Cut(encoded, "#")
	data, err := decodeBase64(encoded)
	if err != nil {
		return nil, errors.New("bad VMess link")
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("bad VMess link")
	}
	field := func(key string) string {
		switch v := raw[key].(type) {
		case string:
			return strings.TrimSpace(v)
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(v)
		}
		return ""
	}
	host := field("add")
	port, err := firstPort(field("port"))
	if err != nil || host == "" || field("id") == "" {
		return nil, errors.New("incomplete VMess link")
	}
	alterID, _ := strconv.Atoi(field("aid"))
	security := field("scy")
	if security == "" {
		security = "auto"
	}
	network := field("net")
	params := map[string]string{
		"type":          network,
		"security":      field("tls"),
		"sni":           field("sni"),
		"alpn":          field("alpn"),
		"fp":            field("fp"),
		"host":          field("host"),
		"path":          field("path"),
		"pbk":           field("pbk"),
		"sid":           field("sid"),
		"spx":           field("spx"),
		"allowInsecure": field("allowInsecure"),
	}
	headerType := field("type")
	switch strings.ToLower(network) {
	case "grpc":
		params["mode"] = headerType
		params["serviceName"] = field("path")
		params["authority"] = field("host")
	case "xhttp", "splithttp":
		params["mode"] = headerType
	default:
		params["headerType"] = headerType
	}
	id := field("id")
	srv := &server{
		protocol: "vmess",
		host:     host,
		port:     port,
		portSpec: field("port"),
		params:   func(key string) string { return params[key] },
		settings: func(dialHost string) map[string]any {
			return map[string]any{"vnext": []any{map[string]any{
				"address": dialHost, "port": port,
				"users": []any{map[string]any{"id": id, "alterId": alterID, "security": security}},
			}}}
		},
	}
	return &parsedLink{srv: srv, Name: field("ps"), FirstHop: net.JoinHostPort(host, strconv.Itoa(port))}, nil
}

// parseWireGuard reads "wireguard://<private key>@host:port?publickey=...&address=...".
func parseWireGuard(l *shareLink, port int) (*parsedLink, error) {
	q := l.query
	privateKey := l.user
	if privateKey == "" {
		privateKey = q.Get("privatekey")
	}
	publicKey := q.Get("publickey")
	if publicKey == "" {
		publicKey = q.Get("publicKey")
	}
	if privateKey == "" || publicKey == "" {
		return nil, errors.New("WireGuard link needs a private and a public key")
	}
	addresses := splitList(q.Get("address"))
	if len(addresses) == 0 {
		addresses = splitList(q.Get("ip"))
	}
	if len(addresses) == 0 {
		addresses = []string{"10.0.0.2/32"}
	}
	mtu, _ := strconv.Atoi(q.Get("mtu"))
	var reserved []int
	for _, item := range splitList(q.Get("reserved")) {
		if n, err := strconv.Atoi(item); err == nil {
			reserved = append(reserved, n)
		}
	}
	preshared := q.Get("presharedkey")
	if preshared == "" {
		preshared = q.Get("preSharedKey")
	}
	srv := &server{
		protocol: "wireguard",
		host:     l.host,
		port:     port,
		portSpec: l.port,
		params:   func(string) string { return "" },
		settings: func(dialHost string) map[string]any {
			peer := map[string]any{
				"publicKey": publicKey,
				"endpoint":  net.JoinHostPort(dialHost, strconv.Itoa(port)),
			}
			if preshared != "" {
				peer["preSharedKey"] = preshared
			}
			settings := map[string]any{
				"secretKey": privateKey,
				"address":   addresses,
				"peers":     []any{peer},
			}
			if mtu > 0 {
				settings["mtu"] = mtu
			}
			if len(reserved) > 0 {
				settings["reserved"] = reserved
			}
			return settings
		},
	}
	return &parsedLink{srv: srv, Name: l.name, FirstHop: net.JoinHostPort(l.host, strconv.Itoa(port))}, nil
}

// outbound builds the Xray outbound JSON. dialHost is where to connect (the
// link's host, or its IP when resolved outside the VPN); names for TLS SNI and
// HTTP Host headers keep using the link's host. insecure reports whether the
// link asks to skip certificate checks.
func (p *parsedLink) outbound(dialHost string) (outbound map[string]any, insecure bool, err error) {
	srv := p.srv
	outbound = map[string]any{
		"tag":      "proxy",
		"protocol": srv.protocol,
		"settings": srv.settings(dialHost),
	}
	if srv.protocol == "wireguard" {
		return outbound, false, nil
	}
	stream, insecure, err := streamSettings(srv, dialHost)
	if err != nil {
		return nil, false, err
	}
	outbound["streamSettings"] = stream
	return outbound, insecure, nil
}

func streamSettings(srv *server, dialHost string) (map[string]any, bool, error) {
	get := srv.params
	nameHost := ""
	if net.ParseIP(srv.host) == nil {
		nameHost = srv.host // a domain: use it for SNI / Host when not given
	}
	resolved := dialHost != srv.host
	headerHost := func(given string) string {
		if given == "" && resolved {
			return nameHost
		}
		return given
	}

	stream := map[string]any{}
	insecure := isTrue(get("allowInsecure")) || isTrue(get("insecure"))

	if srv.protocol == "hysteria" {
		stream["network"] = "hysteria"
		hysteria := map[string]any{"version": 2, "auth": hysteriaAuth(srv)}
		hops := get("mport")
		if hops == "" && strings.ContainsAny(srv.portSpec, ",-") {
			hops = srv.portSpec
		}
		if hops != "" {
			hysteria["udphop"] = map[string]any{"port": hops}
		}
		stream["hysteriaSettings"] = hysteria
		if obfs := strings.ToLower(get("obfs")); obfs == "salamander" {
			stream["finalmask"] = map[string]any{"udp": []any{map[string]any{
				"type": "salamander", "settings": map[string]any{"password": get("obfs-password")},
			}}}
		}
		tls := map[string]any{"alpn": []string{"h3"}}
		if sni := firstNonEmpty(get("sni"), get("peer"), nameHost); sni != "" {
			tls["serverName"] = sni
		}
		if alpn := splitList(get("alpn")); len(alpn) > 0 {
			tls["alpn"] = alpn
		}
		if pin := firstNonEmpty(get("pinSHA256"), get("pcs")); pin != "" {
			tls["pinnedPeerCertSha256"] = pin
		}
		stream["security"] = "tls"
		stream["tlsSettings"] = tls
		return stream, insecure, nil
	}

	network := strings.ToLower(firstNonEmpty(get("type"), "tcp"))
	path := get("path")
	host := get("host")
	switch network {
	case "tcp", "raw":
		stream["network"] = "raw"
		if strings.EqualFold(get("headerType"), "http") {
			paths := splitList(path)
			if len(paths) == 0 {
				paths = []string{"/"}
			}
			request := map[string]any{"path": paths}
			if hosts := splitList(headerHost(host)); len(hosts) > 0 {
				request["headers"] = map[string]any{"Host": hosts}
			}
			stream["rawSettings"] = map[string]any{"header": map[string]any{"type": "http", "request": request}}
		}
	case "ws", "websocket":
		stream["network"] = "ws"
		ws := map[string]any{"path": firstNonEmpty(path, "/")}
		if h := headerHost(host); h != "" {
			ws["host"] = h
		}
		stream["wsSettings"] = ws
	case "httpupgrade":
		stream["network"] = "httpupgrade"
		hu := map[string]any{"path": firstNonEmpty(path, "/")}
		if h := headerHost(host); h != "" {
			hu["host"] = h
		}
		stream["httpupgradeSettings"] = hu
	case "xhttp", "splithttp":
		stream["network"] = "xhttp"
		xh := map[string]any{"path": firstNonEmpty(path, "/"), "mode": firstNonEmpty(get("mode"), "auto")}
		if h := headerHost(host); h != "" {
			xh["host"] = h
		}
		if extra := strings.TrimSpace(get("extra")); extra != "" {
			var parsed map[string]any
			if err := json.Unmarshal([]byte(extra), &parsed); err == nil {
				xh["extra"] = parsed
			}
		}
		stream["xhttpSettings"] = xh
	case "grpc", "gun":
		stream["network"] = "grpc"
		grpc := map[string]any{
			"serviceName": firstNonEmpty(get("serviceName"), strings.TrimPrefix(path, "/")),
			"multiMode":   strings.EqualFold(get("mode"), "multi"),
		}
		if authority := firstNonEmpty(get("authority"), headerHost("")); authority != "" {
			grpc["authority"] = authority
		}
		stream["grpcSettings"] = grpc
	case "kcp", "mkcp":
		stream["network"] = "kcp"
		var masks []any
		switch header := strings.ToLower(get("headerType")); header {
		case "", "none":
		case "wechat-video", "wechat":
			masks = append(masks, map[string]any{"type": "header-wechat"})
		case "srtp", "utp", "dtls", "wireguard":
			masks = append(masks, map[string]any{"type": "header-" + header})
		case "dns":
			masks = append(masks, map[string]any{"type": "header-dns", "settings": map[string]any{"domain": host}})
		}
		if seed := get("seed"); seed != "" {
			masks = append(masks, map[string]any{"type": "mkcp-aes128gcm", "settings": map[string]any{"password": seed}})
		} else {
			masks = append(masks, map[string]any{"type": "mkcp-original"})
		}
		stream["finalmask"] = map[string]any{"udp": masks}
	case "h2", "http", "h3", "quic":
		return nil, false, fmt.Errorf("the %q transport is no longer supported by Xray (servers now use XHTTP)", network)
	default:
		return nil, false, fmt.Errorf("unknown transport %q", network)
	}

	security := strings.ToLower(firstNonEmpty(get("security"), srv.defaultSecurity))
	switch security {
	case "", "none":
	case "tls":
		tls := map[string]any{}
		if sni := firstNonEmpty(get("sni"), get("peer"), host, nameHost); sni != "" {
			tls["serverName"] = sni
		}
		if alpn := splitList(get("alpn")); len(alpn) > 0 {
			tls["alpn"] = alpn
		}
		if fp := get("fp"); fp != "" {
			tls["fingerprint"] = fp
		}
		if pin := get("pcs"); pin != "" {
			tls["pinnedPeerCertSha256"] = pin
		}
		if names := get("vcn"); names != "" {
			tls["verifyPeerCertByName"] = names
		}
		if ech := get("ech"); ech != "" {
			tls["echConfigList"] = ech
		}
		stream["security"] = "tls"
		stream["tlsSettings"] = tls
	case "reality":
		reality := map[string]any{
			"serverName":  firstNonEmpty(get("sni"), nameHost),
			"fingerprint": firstNonEmpty(get("fp"), "chrome"),
			"publicKey":   firstNonEmpty(get("pbk"), get("publicKey")),
			"shortId":     get("sid"),
			"spiderX":     get("spx"),
		}
		if verify := get("pqv"); verify != "" {
			reality["mldsa65Verify"] = verify
		}
		stream["security"] = "reality"
		stream["realitySettings"] = reality
	default:
		return nil, false, fmt.Errorf("unknown security %q", security)
	}
	return stream, insecure, nil
}

func hysteriaAuth(srv *server) string {
	// The user part of hysteria2://<auth>@host is the password (or user:pass).
	if auth := srv.params("auth"); auth != "" {
		return auth
	}
	return srv.auth
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
