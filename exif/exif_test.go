package exif

import (
	"testing"

	exiftool "github.com/barasher/go-exiftool"
)

func TestNormalizeUsesTimeZoneWithSpace(t *testing.T) {
	file := exiftool.FileMetadata{
		File: "canon.jpg",
		Fields: map[string]any{
			"DateTimeOriginal": "2017:12:12 03:27:39",
			"Time Zone":        "-04:00",
		},
	}

	got := normalize(file)
	if got.OffsetTimeOriginal != "-04:00" {
		t.Fatalf("OffsetTimeOriginal = %q, want %q", got.OffsetTimeOriginal, "-04:00")
	}
	if got.DateTimeOriginal == nil {
		t.Fatal("DateTimeOriginal is nil")
	}
}

func TestNormalizeOffsetVariants(t *testing.T) {
	tests := map[string]string{
		"-04:00": "-04:00",
		"-0400":  "-04:00",
		"-4":     "-04:00",
		"+8":     "+08:00",
		"-240":   "-04:00",
		"+330":   "+05:30",
	}

	for input, want := range tests {
		if got := normalizeOffset(input); got != want {
			t.Fatalf("normalizeOffset(%q) = %q, want %q", input, got, want)
		}
	}
}
