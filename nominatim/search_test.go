package nominatim

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_CreateSearchQuery(t *testing.T) {
	expectation := "q=Berlin"
	query := new(SearchQuery)
	query.Q = "Berlin"
	values, err := query.buildQuery()
	if !strings.Contains(values.Encode(), expectation) {
		t.Error(fmt.Sprintf("resulting query should contain %s", expectation))
	}
	if err != nil {
		t.Error(fmt.Sprintf("triggered error that was not supposed to: %s", err.Error()))
	}
}

func Test_CreateSearchQueryWithParams(t *testing.T) {
	expectations := []string{
		"city=Berlin",
		"street=Karl-Marx-Allee",
		"county=Berlin",
		"state=Germany",
		"postalcode=012345",
	}
	query := &SearchQuery{
		City:       "Berlin",
		Street:     "Karl-Marx-Allee",
		County:     "Berlin",
		State:      "Germany",
		PostalCode: "012345",
	}
	values, err := query.buildQuery()
	for i := range expectations {
		if !strings.Contains(values.Encode(), expectations[i]) {
			t.Error(fmt.Sprintf("resulting query should contain %s", expectations[i]))
		}
	}
	if err != nil {
		t.Error(fmt.Sprintf("triggered error that was not supposed to: %s", err.Error()))
	}
}

func Test_SpecificFieldsUsed(t *testing.T) {
	q1 := &SearchQuery{
		City:       "Berlin",
		Street:     "Karl-Marx-Allee",
		County:     "Berlin",
		State:      "Germany",
		PostalCode: "012345",
	}
	q2 := new(SearchQuery)
	q2.Q = "Berlin"
	if !q1.specificFieldsUsed() {
		t.Error("Q1 -> specific fields are used. should return true")
	}
	if q2.specificFieldsUsed() {
		t.Error("Q2 -> specific fields are not used. should return false")
	}
}

func Test_EmptySearchQuery(t *testing.T) {
	query := new(SearchQuery)
	_, err := query.buildQuery()
	if err == nil {
		t.Error("Empty query should result in an error")
	}
}

func Test_DoubleSearchQuery(t *testing.T) {
	query := &SearchQuery{
		City:       "Berlin",
		Street:     "Karl-Marx-Allee",
		County:     "Berlin",
		State:      "Germany",
		PostalCode: "012345",
		Q:          "Berlin",
	}
	expectations := []string{
		"city=Berlin",
		"street=Karl-Marx-Allee",
		"county=Berlin",
		"state=Germany",
		"postalcode=012345",
	}
	values, err := query.buildQuery()
	encoded := values.Encode()
	for i := range expectations {
		if strings.Contains(encoded, expectations[i]) {
			t.Error(fmt.Sprintf("query should not contain %s", expectations[i]))
		}
	}
	if !strings.Contains(encoded, "q=Berlin") {
		t.Error("query should contain q=Berlin")
	}
	if err != nil {
		t.Error("should not throw error")
	}
}

func Test_LimitedSearchQuery(t *testing.T) {
	expectation := "limit=123"
	query := new(SearchQuery)
	query.Q = "Berlin"
	query.Limit = 123
	values, err := query.buildQuery()
	if !strings.Contains(values.Encode(), expectation) {
		t.Error(fmt.Sprintf("resulting query should contain %s", expectation))
	}
	if err != nil {
		t.Error(fmt.Sprintf("triggered error that was not supposed to: %s", err.Error()))
	}
}

func Test_ClientDefaultAcceptLanguage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Query().Get("accept-language"), "en-US,en"; got != want {
			t.Fatalf("accept-language=%q, want %q", got, want)
		}
		_, _ = w.Write([]byte(`[{"place_id":1,"lat":"52.5","lon":"13.4","display_name":"Berlin"}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-agent")
	_, err := client.Search(&SearchQuery{Q: "Berlin"})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
}

func Test_QueryAcceptLanguageOverridesClientDefault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Query().Get("accept-language"), "ja"; got != want {
			t.Fatalf("accept-language=%q, want %q", got, want)
		}
		_, _ = w.Write([]byte(`[{"place_id":1,"lat":"35.0","lon":"135.0","display_name":"京都"}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-agent")
	_, err := client.Search(&SearchQuery{Q: "Kyoto", AcceptLanguage: "ja"})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
}

func Test_SetDefaultAcceptLanguage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Query().Get("accept-language"), "th,en"; got != want {
			t.Fatalf("accept-language=%q, want %q", got, want)
		}
		_, _ = w.Write([]byte(`[{"place_id":1,"lat":"13.7","lon":"100.5","display_name":"Bangkok"}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-agent")
	client.SetDefaultAcceptLanguage("th,en")
	_, err := client.Search(&SearchQuery{Q: "Bangkok"})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
}

func Test_AddressFields(t *testing.T) {
	client := NewClient(PublicURL, "test-agent")
	query := &SearchQuery{Q: "Unter den Linden"}
	resp, err := client.Search(query)
	if err != nil {
		t.Error(fmt.Sprintf("triggered error that was not supposed to: %s", err.Error()))
		return
	}
	if resp[0].Address.Suburb != "" {
		t.Error("Address should contain suburb")
	}
	if resp[0].Address.State != "" {
		t.Error("Address should contain State")
	}
}
