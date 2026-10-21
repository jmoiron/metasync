package store

import (
	"testing"
	"time"

	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/sqlx"
)

func TestGPSLogEntriesUpsertBySourcePath(t *testing.T) {
	db, err := sqlx.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE gps_log_entries (
		source_path TEXT PRIMARY KEY,
		local_datetime TEXT NOT NULL,
		utc_offset TEXT,
		utc_datetime TEXT NOT NULL,
		latitude REAL NOT NULL,
		longitude REAL NOT NULL,
		updated_at TEXT NOT NULL
	)`)
	if err != nil {
		t.Fatal(err)
	}
	st := &Store{db: db}

	entry := model.GPSLogEntry{
		SourcePath:    "/photos/one.jpg",
		LocalDateTime: "2026-10-20 09:30:00",
		Offset:        "+09:00",
		UTCDateTime:   time.Date(2026, 10, 20, 0, 30, 0, 0, time.UTC),
		Latitude:      13.4125,
		Longitude:     103.8667,
	}
	if err := st.UpsertGPSLogEntries([]model.GPSLogEntry{entry}); err != nil {
		t.Fatal(err)
	}
	entry.Latitude = 13.5
	if err := st.UpsertGPSLogEntries([]model.GPSLogEntry{entry}); err != nil {
		t.Fatal(err)
	}
	withoutOffset := entry
	withoutOffset.SourcePath = "/photos/two.jpg"
	withoutOffset.Offset = ""
	if err := st.UpsertGPSLogEntries([]model.GPSLogEntry{withoutOffset}); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO gps_log_entries (
		source_path, local_datetime, utc_offset, utc_datetime, latitude, longitude, updated_at
	) VALUES (?, ?, NULL, ?, ?, ?, ?)`, "/photos/old.jpg", "1970-01-01 00:00:10", "1970-01-01T00:00:10Z", 13.5, 103.8, "2026-10-20T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}

	entries, err := st.GPSLogEntries()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected two entries, got %d", len(entries))
	}
	count, err := st.GPSLogEntryCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("expected count 3 including the filtered old entry, got %d", count)
	}
	if entries[0].Latitude != 13.5 {
		t.Fatalf("expected updated latitude 13.5, got %v", entries[0].Latitude)
	}
	if !entries[0].UTCDateTime.Equal(entry.UTCDateTime) || entries[0].Offset != "+09:00" {
		t.Fatalf("unexpected round-trip entry: %#v", entries[0])
	}
	if entries[1].Offset != "" {
		t.Fatalf("expected missing offset to round-trip as empty, got %q", entries[1].Offset)
	}
	deleted, err := st.DeleteGPSLogEntry("/photos/two.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("expected to delete one entry, got %d", deleted)
	}
}
