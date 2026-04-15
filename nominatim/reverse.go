package nominatim

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
)

type reverseAPIResult struct {
	ReverseResult
	Error string `json:"error"`
}

type ReverseResult struct {
	PlaceID     int64   `json:"place_id"`
	License     string  `json:"license"`
	OSMType     string  `json:"osm_type"`
	OSMID       int64   `json:"osm_id"`
	Lat         string  `json:"lat"`
	Lon         string  `json:"lon"`
	DisplayName string  `json:"display_name"`
	Address     Address `json:"address"`
}

type ReverseQuery struct {
	JSONCallback   any
	AcceptLanguage string
	OSMType        string
	OSMID          string
	Lat            string
	Lon            string
	Zoom           int
	AddressDetails bool
	Email          string
}

func (q *ReverseQuery) buildQuery() (url.Values, error) {
	if q.Lat == "" {
		return nil, errors.New("cannot reverse geocode without Lat")
	}
	if q.Lon == "" {
		return nil, errors.New("cannot reverse geocode without Lon")
	}
	if q.Zoom < 0 || q.Zoom > 18 {
		return nil, fmt.Errorf("zoom must be between 0 and 18, got %d", q.Zoom)
	}

	values := url.Values{}
	values.Set("format", "json")
	values.Set("lat", q.Lat)
	values.Set("lon", q.Lon)
	values.Set("zoom", strconv.Itoa(q.Zoom))
	if q.AcceptLanguage != "" {
		values.Set("accept-language", q.AcceptLanguage)
	}
	if q.JSONCallback != nil {
		return nil, errors.New("JSONCallback is not supported")
	}
	if q.OSMType != "" {
		switch q.OSMType {
		case "N", "W", "R":
			values.Set("osm_type", q.OSMType)
		default:
			return nil, errors.New("OSMType must be one of N, W, or R")
		}
	}
	if q.OSMID != "" {
		values.Set("osm_id", q.OSMID)
	}
	if q.AddressDetails {
		values.Set("addressdetails", "1")
	} else {
		values.Set("addressdetails", "0")
	}
	if q.Email != "" {
		values.Set("email", q.Email)
	}

	return values, nil
}

func decodeReverseResult(body io.Reader) (*ReverseResult, error) {
	var result reverseAPIResult
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		return nil, err
	}
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}
	return &result.ReverseResult, nil
}
