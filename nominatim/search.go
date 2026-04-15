package nominatim

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"
)

type searchResultError struct {
	Error string `json:"error"`
}

type SearchResult struct {
	PlaceID       int64      `json:"place_id"`
	License       string     `json:"license"`
	OSMType       string     `json:"osm_type"`
	OSMID         int64      `json:"osm_id"`
	BoundingBox   []string   `json:"boundingbox"`
	PolygonPoints [][]string `json:"polygonpoints"`
	Lat           string     `json:"lat"`
	Lon           string     `json:"lon"`
	DisplayName   string     `json:"display_name"`
	Class         string     `json:"class"`
	Type          string     `json:"type"`
	Address       Address    `json:"address"`
	Importance    float32    `json:"importance"`
}

type SearchQuery struct {
	JSONCallback    any
	AcceptLanguage  string
	Q               string
	Street          string
	City            string
	County          string
	State           string
	PostalCode      string
	CountryCodes    []string
	ViewBox         string
	Bounded         bool
	Polygon         bool
	AddressDetails  bool
	Email           string
	ExcludePlaceIDs []string
	Limit           int
	PolygonGeoJSON  bool
	PolygonKML      bool
	PolygonText     bool
	PolygonSVG      bool
}

func (q *SearchQuery) specificFieldsUsed() bool {
	return q.Street != "" || q.City != "" || q.County != "" || q.State != "" || q.PostalCode != ""
}

func (q *SearchQuery) buildQuery() (url.Values, error) {
	values := url.Values{}
	values.Set("format", "json")

	if q.JSONCallback != nil {
		callbackJSON, err := json.Marshal(q.JSONCallback)
		if err != nil {
			return nil, err
		}
		values.Set("json_callback", string(callbackJSON))
	}
	if q.AcceptLanguage != "" {
		values.Set("accept-language", q.AcceptLanguage)
	}
	if q.Q != "" {
		values.Set("q", q.Q)
	} else if q.specificFieldsUsed() {
		if q.Street != "" {
			values.Set("street", q.Street)
		}
		if q.City != "" {
			values.Set("city", q.City)
		}
		if q.County != "" {
			values.Set("county", q.County)
		}
		if q.State != "" {
			values.Set("state", q.State)
		}
		if q.PostalCode != "" {
			values.Set("postalcode", q.PostalCode)
		}
	} else {
		return nil, errors.New("must set Q or at least one of Street, City, County, State, or PostalCode")
	}

	if len(q.CountryCodes) > 0 {
		values.Set("countrycodes", strings.Join(q.CountryCodes, ","))
	}
	if q.ViewBox != "" {
		values.Set("viewbox", q.ViewBox)
	}
	if q.Bounded {
		values.Set("bounded", "1")
	} else {
		values.Set("bounded", "0")
	}
	if q.Polygon {
		values.Set("polygon", "1")
	} else {
		values.Set("polygon", "0")
	}
	if q.AddressDetails {
		values.Set("addressdetails", "1")
	} else {
		values.Set("addressdetails", "0")
	}
	if q.Email != "" {
		values.Set("email", q.Email)
	}
	if len(q.ExcludePlaceIDs) > 0 {
		values.Set("exclude_place_ids", strings.Join(q.ExcludePlaceIDs, ","))
	}
	if q.Limit > 0 {
		values.Set("limit", strconv.Itoa(q.Limit))
	}
	if q.PolygonGeoJSON {
		values.Set("polygon_geojson", "1")
	} else {
		values.Set("polygon_geojson", "0")
	}
	if q.PolygonKML {
		values.Set("polygon_kml", "1")
	} else {
		values.Set("polygon_kml", "0")
	}
	if q.PolygonSVG {
		values.Set("polygon_svg", "1")
	} else {
		values.Set("polygon_svg", "0")
	}
	if q.PolygonText {
		values.Set("polygon_text", "1")
	} else {
		values.Set("polygon_text", "0")
	}

	return values, nil
}

func decodeSearchResults(body io.Reader) ([]SearchResult, error) {
	// Nominatim search replies with one of two top-level JSON shapes:
	// either a result array on success or an object containing {"error": ...}.
	// Buffer once so we can attempt both mutually exclusive decodes.
	blob, err := io.ReadAll(body)
	if err != nil {
		return nil, err
	}

	var result []SearchResult
	if err := json.Unmarshal(blob, &result); err == nil {
		if len(result) == 0 {
			return nil, errors.New("nothing found")
		}
		return result, nil
	}

	var resultErr searchResultError
	if err := json.Unmarshal(blob, &resultErr); err != nil {
		return nil, err
	}
	if resultErr.Error != "" {
		return nil, errors.New(resultErr.Error)
	}
	return nil, errors.New("search request returned an unexpected response")
}
