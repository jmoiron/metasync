# Nominatim

Nominatim is a Go library to access the OSM Nominatim geocoding services.

It is based in large part off of go-nominatim by Daniel Brendel.

## Geocoding?

If you want to determine the coordinates of a certain location by only having its
name, you can do this via a geocoding service. If you want to do this in Go, you
probably want to use nominatim to do it.

## License

[LGPLv3](https://www.gnu.org/licenses/lgpl.html)

## Usage of the Openstreetmaps-Nominatim Server

Please refer to the [Nominatim Wiki](http://wiki.openstreetmap.org/wiki/Nominatim)
if you plan to use the nominatim service of openstreetmaps. If you plan to generate
high loads with geoqueries, it would be nice if you did it on your own infrastructure, not on
their server.

## Examples

```go
package main

import (
	"fmt"

	nominatim "github.com/jmoiron/metasync/nominatim"
)

func main() {
	client := nominatim.NewClient(nominatim.PublicURL, "my-app/1.0")

	// Get by a query string.
	resp, _ := client.Query("Hamburg")
	fmt.Printf("Found location: %s (%s, %s)\n", resp[0].DisplayName, resp[0].Lat, resp[0].Lon)

	// Get by city.
	qry := nominatim.SearchQuery{
		City: "Berlin",
	}
	resp, _ = client.Search(&qry)
	fmt.Printf("Found location: %s (%s, %s)\n", resp[0].DisplayName, resp[0].Lat, resp[0].Lon)

	// Reverse geocoding.
	rqry := nominatim.ReverseQuery{
		Lat: "52.5170365",
		Lon: "13.3888599",
	}
	rresp, _ := client.Reverse(&rqry)
	fmt.Printf("Found %s\n", rresp.DisplayName)
}
```
