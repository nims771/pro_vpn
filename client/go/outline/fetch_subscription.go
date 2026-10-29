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
	"io"
	"net/http"
	"strings"
	"time"

	"localhost/client/go/outline/platerrors"
)

// subscriptionUserAgent makes panels such as Marzban and 3x-ui return the plain
// (base64) list of share links rather than an HTML page or a Clash/sing-box config.
const subscriptionUserAgent = "v2rayN/6.0"

const maxSubscriptionBodySize = 4 << 20 // 4 MiB

type fetchSubscriptionResponse struct {
	Body string `json:"body"`
	// Raw "Subscription-Userinfo" header, e.g. "upload=1; download=2; total=3; expire=4".
	UserInfo string `json:"userInfo"`
	// Raw "Profile-Title" header (may be "base64:...").
	Title string `json:"title"`
	// Raw "Profile-Update-Interval" header, in hours.
	UpdateInterval string `json:"updateInterval"`
	// Raw "Profile-Web-Page-Url" / "Support-Url" headers.
	WebPageURL string `json:"webPageUrl"`
	SupportURL string `json:"supportUrl"`
}

// fetchSubscriptionRequest is the JSON input of FetchSubscription. A plain URL
// string is accepted too.
type fetchSubscriptionRequest struct {
	URL string `json:"url"`
	// Extra headers, e.g. x-hwid / x-device-os for panels that limit devices.
	Headers map[string]string `json:"headers"`
}

// fetchSubscription downloads a VPN subscription and returns its body together with
// the informational headers panels attach to it (traffic quota, expiry, title), as JSON.
func fetchSubscription(input string) (string, error) {
	request := fetchSubscriptionRequest{URL: strings.TrimSpace(input)}
	if strings.HasPrefix(request.URL, "{") {
		if err := json.Unmarshal([]byte(input), &request); err != nil {
			return "", platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: "invalid subscription request",
				Cause:   platerrors.ToPlatformError(err),
			}
		}
	}
	url := request.URL
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "invalid subscription URL",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	req.Header.Set("User-Agent", subscriptionUserAgent)
	req.Header.Set("Accept", "*/*")
	for name, value := range request.Headers {
		if name != "" && value != "" {
			req.Header.Set(name, value)
		}
	}

	// Fork: outside the VPN first, so a blocked server can still be replaced.
	resp, err := doOutsideVPNFirst(req, 20*time.Second)
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "failed to fetch the subscription",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSubscriptionBodySize))
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "failed to read the subscription",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	if resp.StatusCode > 299 {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "non-successful HTTP status",
			Details: platerrors.ErrorDetails{"status": resp.Status},
		}
	}

	out, err := json.Marshal(fetchSubscriptionResponse{
		Body:           string(body),
		UserInfo:       resp.Header.Get("Subscription-Userinfo"),
		Title:          resp.Header.Get("Profile-Title"),
		UpdateInterval: resp.Header.Get("Profile-Update-Interval"),
		WebPageURL:     resp.Header.Get("Profile-Web-Page-Url"),
		SupportURL:     resp.Header.Get("Support-Url"),
	})
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.InternalError,
			Message: "failed to encode the subscription",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	return string(out), nil
}
