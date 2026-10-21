package web

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jmoiron/metasync/model"
)

func TestValidateGPSLogEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "photo.jpg")
	if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
		t.Fatal(err)
	}

	entry, err := validateGPSLogEntry(model.GPSLogEntry{
		SourcePath:    path,
		LocalDateTime: "2026-10-20 09:30:00",
		Offset:        "+09:00",
		UTCDateTime:   time.Date(2026, 10, 20, 0, 30, 0, 0, time.UTC),
		Latitude:      13.4125,
		Longitude:     103.8667,
	})
	if err != nil {
		t.Fatal(err)
	}
	if entry.SourcePath != path || entry.UTCDateTime.Location() != time.UTC {
		t.Fatalf("entry was not normalized: %#v", entry)
	}
	for _, oldTime := range []time.Time{time.Unix(0, 0), time.Date(1974, 12, 31, 23, 59, 59, 0, time.UTC)} {
		oldEntry := entry
		oldEntry.UTCDateTime = oldTime
		if _, err := validateGPSLogEntry(oldEntry); err == nil {
			t.Errorf("expected pre-1975 timestamp %s to be rejected", oldTime)
		}
	}

	entry.Latitude = 91
	if _, err := validateGPSLogEntry(entry); err == nil {
		t.Fatal("expected out-of-range latitude error")
	}
}
