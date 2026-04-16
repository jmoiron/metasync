package main

import (
	"fmt"

	nominatim "github.com/jmoiron/metasync/nominatim"
)

func main() {
	client := nominatim.NewClient(nominatim.PublicURL, "example-client")
	client.SetDefaultAcceptLanguage("en-US,en")

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
