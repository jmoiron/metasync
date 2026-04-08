package exif

import (
	"encoding/json"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestWritePreservesUnchangedExifData(t *testing.T) {
	if _, err := exec.LookPath("exiftool"); err != nil {
		t.Skip("exiftool not available")
	}

	src := filepath.Join("..", "data", "exiftest.jpg")
	tmpDir := t.TempDir()
	dst := filepath.Join(tmpDir, "exiftest-copy.jpg")
	copyFile(t, src, dst)

	before := exifSnapshot(t, dst)

	ex, err := New()
	if err != nil {
		t.Fatalf("new extractor: %v", err)
	}
	defer ex.Close()

	ts := time.Date(2023, time.August, 17, 9, 10, 11, 0, time.FixedZone("test", -4*60*60))
	lat := 37.421999
	lon := -122.084057
	if err := ex.Write(dst, WriteRequest{
		Time:         &ts,
		GPSLatitude:  &lat,
		GPSLongitude: &lon,
	}); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	after := exifSnapshot(t, dst)
	assertChangedValue(t, after, "ExifIFD:DateTimeOriginal", "2023:08:17 09:10:11")
	assertChangedValue(t, after, "ExifIFD:CreateDate", "2023:08:17 09:10:11")
	assertChangedValue(t, after, "IFD0:ModifyDate", "2023:08:17 09:10:11")
	assertChangedFloat(t, after, "GPS:GPSLatitude", math.Abs(lat))
	assertChangedValue(t, after, "GPS:GPSLatitudeRef", "N")
	assertChangedFloat(t, after, "GPS:GPSLongitude", math.Abs(lon))
	assertChangedValue(t, after, "GPS:GPSLongitudeRef", "W")

	extracted := ex.Extract([]string{dst})[dst]
	if extracted.GPSLatitude == nil || math.Abs(*extracted.GPSLatitude-lat) > 0.000001 {
		t.Fatalf("normalized latitude = %v, want %f", extracted.GPSLatitude, lat)
	}
	if extracted.GPSLongitude == nil || math.Abs(*extracted.GPSLongitude-lon) > 0.000001 {
		t.Fatalf("normalized longitude = %v, want %f", extracted.GPSLongitude, lon)
	}

	filterSnapshot(before)
	filterSnapshot(after)

	if !reflect.DeepEqual(before, after) {
		t.Fatalf("metadata changed outside expected GPS/time fields")
	}
}

func exifSnapshot(t *testing.T, path string) map[string]any {
	t.Helper()

	cmd := exec.Command("exiftool", "-j", "-a", "-u", "-n", "-G1", path)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("exiftool snapshot %s: %v", path, err)
	}

	var rows []map[string]any
	if err := json.Unmarshal(out, &rows); err != nil {
		t.Fatalf("unmarshal exiftool output: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("unexpected exiftool row count: %d", len(rows))
	}
	return rows[0]
}

func filterSnapshot(snapshot map[string]any) {
	for key := range snapshot {
		switch {
		case key == "SourceFile":
			delete(snapshot, key)
		case strings.HasPrefix(key, "System:"):
			delete(snapshot, key)
		case strings.HasPrefix(key, "File:"):
			delete(snapshot, key)
		case strings.HasPrefix(key, "ExifTool:"):
			delete(snapshot, key)
		case strings.HasPrefix(key, "Composite:"):
			delete(snapshot, key)
		case strings.HasPrefix(key, "GPS:"):
			delete(snapshot, key)
		case key == "IFD1:ThumbnailOffset":
			delete(snapshot, key)
		case key == "MPImage2:MPImageStart":
			delete(snapshot, key)
		case key == "ExifIFD:DateTimeOriginal":
			delete(snapshot, key)
		case key == "ExifIFD:CreateDate":
			delete(snapshot, key)
		case key == "IFD0:ModifyDate":
			delete(snapshot, key)
		case key == "ExifIFD:OffsetTime":
			delete(snapshot, key)
		case key == "ExifIFD:OffsetTimeOriginal":
			delete(snapshot, key)
		case key == "ExifIFD:OffsetTimeDigitized":
			delete(snapshot, key)
		}
	}
}

func assertChangedValue(t *testing.T, snapshot map[string]any, key, want string) {
	t.Helper()

	got, ok := snapshot[key]
	if !ok {
		t.Fatalf("missing key %s", key)
	}
	if got != want {
		t.Fatalf("%s = %v, want %s", key, got, want)
	}
}

func assertChangedFloat(t *testing.T, snapshot map[string]any, key string, want float64) {
	t.Helper()

	got, ok := snapshot[key]
	if !ok {
		t.Fatalf("missing key %s", key)
	}
	value, ok := got.(float64)
	if !ok {
		t.Fatalf("%s has non-float value %T", key, got)
	}
	if math.Abs(value-want) > 0.000001 {
		t.Fatalf("%s = %f, want %f", key, value, want)
	}
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper()

	in, err := os.Open(src)
	if err != nil {
		t.Fatalf("open %s: %v", src, err)
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		t.Fatalf("stat %s: %v", src, err)
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		t.Fatalf("create %s: %v", dst, err)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		t.Fatalf("copy %s to %s: %v", src, dst, err)
	}
}
