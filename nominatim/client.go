package nominatim

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	defaultUserAgent = "nominatim-go-client"
	PublicURL        = "https://nominatim.openstreetmap.org/"
)

type Client struct {
	baseURL    string
	userAgent  string
	httpClient *http.Client
}

func NewClient(rawURL, userAgent string) *Client {
	trimmedURL := strings.TrimRight(strings.TrimSpace(rawURL), "/")
	trimmedUA := strings.TrimSpace(userAgent)
	if trimmedUA == "" {
		trimmedUA = defaultUserAgent
	}
	return &Client{
		baseURL:    trimmedURL,
		userAgent:  trimmedUA,
		httpClient: http.DefaultClient,
	}
}

func (c *Client) Query(queryString string) ([]SearchResult, error) {
	return c.Search(&SearchQuery{Q: queryString})
}

func (c *Client) Search(query *SearchQuery) ([]SearchResult, error) {
	if query == nil {
		return nil, fmt.Errorf("query is nil")
	}
	values, err := query.buildQuery()
	if err != nil {
		return nil, err
	}
	queryString, err := c.buildURL("/search", values)
	if err != nil {
		return nil, err
	}

	body, err := c.get(queryString)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	return decodeSearchResults(body)
}

func (c *Client) Reverse(query *ReverseQuery) (*ReverseResult, error) {
	if query == nil {
		return nil, fmt.Errorf("query is nil")
	}
	values, err := query.buildQuery()
	if err != nil {
		return nil, err
	}
	queryString, err := c.buildURL("/reverse", values)
	if err != nil {
		return nil, err
	}

	body, err := c.get(queryString)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	return decodeReverseResult(body)
}

func (c *Client) requireBaseURL() (string, error) {
	if c == nil || c.baseURL == "" {
		return "", fmt.Errorf("client base URL is not set; call nominatim.NewClient(...)")
	}
	return c.baseURL, nil
}

func (c *Client) get(rawURL string) (io.ReadCloser, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent)

	httpClient := c.httpClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request %q failed: %w", rawURL, err)
	}
	if resp.StatusCode > http.StatusMultipleChoices {
		defer resp.Body.Close()
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("request %q failed: status %d", rawURL, resp.StatusCode)
		}
		return nil, fmt.Errorf("request %q failed: status %d: %s", rawURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return resp.Body, nil
}

func (c *Client) buildURL(path string, values url.Values) (string, error) {
	base, err := c.requireBaseURL()
	if err != nil {
		return "", err
	}
	u, err := url.Parse(base + path)
	if err != nil {
		return "", err
	}
	u.RawQuery = values.Encode()
	return u.String(), nil
}
