package nominatim

import (
	"strings"
	"testing"
)

func Test_CreateReverseQuery(t *testing.T) {
	query := new(ReverseQuery)
	query.Lat = "52.5170365"
	query.Lon = "13.3888599"
	values, _ := query.buildQuery()
	encoded := values.Encode()
	if !strings.Contains(encoded, "lat=52.5170365") || !strings.Contains(encoded, "13.3888599") {
		t.Error("query does not contain longitude and latitude")
	}
}

func Test_ReverseQueryWithoutServer(t *testing.T) {
	client := NewClient("", "test-agent")
	_, err := client.buildURL("/reverse", nil)
	if err != nil {
		if err.Error() != "client base URL is not set; call nominatim.NewClient(...)" {
			t.Error("Expecting error about unset server. Received" + err.Error())
		}
	} else {
		t.Error("Expected error about unset server. Got none.")
	}
}

func Test_OSMType(t *testing.T) {
	query := new(ReverseQuery)
	query.Lat = "52.5170365"
	query.Lon = "13.3888599"
	query.OSMType = "V"
	_, err := query.buildQuery()
	if err != nil {
		if err.Error() != "OSMType must be one of N, W, or R" {
			t.Error("Expecting error about Wrong OSMType. Received" + err.Error())
		}
	} else {
		t.Error("Expecting error about Wrong OSMType. Got none.")
	}

	query = new(ReverseQuery)
	query.Lat = "52.5170365"
	query.Lon = "13.3888599"
	query.OSMType = "R"
	_, err = query.buildQuery()
	if err != nil {
		t.Error("Expecting no error. Got " + err.Error())
	}
}

func Test_LatLon(t *testing.T) {
	query := new(ReverseQuery)
	query.Lon = "13.3888599"
	_, err := query.buildQuery()
	if err != nil {
		if err.Error() != "cannot reverse geocode without Lat" {
			t.Error("Expecting error about missing latitude. Received" + err.Error())
		}
	} else {
		t.Error("Expecting error about missing latitude. Got none.")
	}

	query = new(ReverseQuery)
	query.Lat = "52.5170365"
	_, err = query.buildQuery()
	if err != nil {
		if err.Error() != "cannot reverse geocode without Lon" {
			t.Error("Expecting error about missing longitude. Received" + err.Error())
		}
	} else {
		t.Error("Expecting error about missing longitude. Got none.")
	}
}

func Test_Zoom(t *testing.T) {
	query := new(ReverseQuery)
	query.Lon = "13.3888599"
	query.Lat = "52.5170365"
	query.Zoom = 1337
	_, err := query.buildQuery()
	if err != nil {
		if err.Error() != "zoom must be between 0 and 18, got 1337" {
			t.Error("Expecting error about wrong Zoomfactor. Received" + err.Error())
		}
	} else {
		t.Error("Expecting error about wrong Zoomfactor. Got none.")
	}

	query = new(ReverseQuery)
	query.Lon = "13.3888599"
	query.Lat = "52.5170365"
	query.Zoom = 13
	_, err = query.buildQuery()
	if err != nil {
		t.Error("Expecting no error. Got " + err.Error())
	}
}
