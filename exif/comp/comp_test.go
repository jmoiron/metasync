package comp

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/metasync/model"
	"github.com/kolesa-team/goexiv"
)

type fixture struct {
	name string
	path string
}

const corpusDir = "testdata/corpus"

var corpusExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".tif": true,
	".tiff": true, ".webp": true, ".cr2": true, ".cr3": true,
	".hif": true,
}

var writeTestExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".tif": true,
	".tiff": true, ".cr2": true, ".cr3": true, ".hif": true,
}

func TestCorpusReadableByBothLibraries(t *testing.T) {
	fixtures := loadCorpus(t)
	if _, err := exec.LookPath("exiftool"); err != nil {
		t.Skip("exiftool is required for the go-exiftool implementation")
	}

	extractor, err := exif.New()
	if err != nil {
		t.Fatalf("initialize go-exiftool extractor: %v", err)
	}
	defer extractor.Close()

	for _, item := range fixtures {
		t.Run(item.name, func(t *testing.T) {
			got := extractor.Extract([]string{item.path})
			metadata, ok := got[item.path]
			if !ok {
				t.Fatalf("go-exiftool returned no result for %s", item.path)
			}

			image, err := openExiv(item.path)
			if err != nil {
				t.Fatalf("goexiv read: %v", err)
			}
			tags := image.GetExifData().AllTags()
			runtime.KeepAlive(image)

			compareCommonTags(t, metadata, tags)
		})
	}
}

func TestCrossLibraryWritesAcrossFormats(t *testing.T) {
	fixtures := loadCorpus(t)
	if _, err := exec.LookPath("exiftool"); err != nil {
		t.Skip("exiftool is required for the go-exiftool implementation")
	}

	extractor, err := exif.New()
	if err != nil {
		t.Fatalf("initialize go-exiftool extractor: %v", err)
	}
	defer extractor.Close()

	writeTime := time.Date(2024, time.March, 4, 5, 6, 7, 0, time.FixedZone("test", 5*60*60+30*60))
	gpsTime := time.Date(2024, time.March, 3, 23, 36, 7, 0, time.UTC)
	latitude := -37.813629
	longitude := 144.963058

	for _, item := range fixtures {
		ext := strings.ToLower(filepath.Ext(item.name))
		if !writeTestExtensions[ext] {
			continue
		}
		t.Run(item.name, func(t *testing.T) {
			t.Run("go-exiftool-to-goexiv", func(t *testing.T) {
				path := copyFixture(t, item.path)
				err := extractor.Write(path, exif.WriteRequest{
					Time:         &writeTime,
					GPSTime:      &gpsTime,
					GPSLatitude:  &latitude,
					GPSLongitude: &longitude,
				})
				if err != nil {
					t.Fatalf("go-exiftool write: %v", err)
				}

				image, err := openExiv(path)
				if err != nil {
					t.Fatalf("goexiv cross-read: %v", err)
				}
				tags := image.GetExifData().AllTags()
				runtime.KeepAlive(image)
				assertTag(t, tags, "Exif.Photo.DateTimeOriginal", writeTime.Format("2006:01:02 15:04:05"))
				assertTag(t, tags, "Exif.Photo.OffsetTimeOriginal", "+05:30")
				assertHasTag(t, tags, "Exif.GPSInfo.GPSLatitude")
				assertHasTag(t, tags, "Exif.GPSInfo.GPSLongitude")
				assertHasTag(t, tags, "Exif.GPSInfo.GPSDateStamp")
			})

			t.Run("goexiv-to-go-exiftool", func(t *testing.T) {
				path := copyFixture(t, item.path)
				image, err := goexiv.Open(path)
				if err != nil {
					t.Fatalf("goexiv open: %v", err)
				}
				if err := image.ReadMetadata(); err != nil {
					t.Fatalf("goexiv read before write: %v", err)
				}
				if err := image.SetExifString("Exif.Photo.DateTimeOriginal", writeTime.Format("2006:01:02 15:04:05")); err != nil {
					if isBMFF(item.name) && strings.Contains(err.Error(), "not supported") {
						t.Logf("local goexiv/exiv2 reports expected BMFF write limitation: %v", err)
						return
					}
					t.Fatalf("goexiv write DateTimeOriginal: %v", err)
				}
				if err := image.SetExifString("Exif.Photo.OffsetTimeOriginal", "+05:30"); err != nil {
					t.Fatalf("goexiv write OffsetTimeOriginal: %v", err)
				}
				if err := image.SetExifString("Exif.Image.ImageDescription", "metasync exiv2 compatibility test"); err != nil {
					t.Fatalf("goexiv write ImageDescription: %v", err)
				}
				runtime.KeepAlive(image)

				metadata := extractor.Extract([]string{path})[path]
				if metadata.DateTimeOriginal == nil {
					t.Fatal("go-exiftool did not read DateTimeOriginal written by goexiv")
				}
				if got := metadata.DateTimeOriginal.Format("2006:01:02 15:04:05"); got != writeTime.Format("2006:01:02 15:04:05") {
					t.Errorf("DateTimeOriginal = %q, want %q", got, writeTime.Format("2006:01:02 15:04:05"))
				}
				if metadata.OffsetTimeOriginal != "+05:30" {
					t.Errorf("OffsetTimeOriginal = %q, want +05:30", metadata.OffsetTimeOriginal)
				}

				full, err := exif.Full(context.Background(), path)
				if err != nil {
					t.Fatalf("go-exiftool full cross-read: %v", err)
				}
				if !hasTagSuffix(full, "ImageDescription") {
					t.Errorf("go-exiftool did not find ImageDescription written by goexiv: %#v", full)
				}
			})
		})
	}
}

func openExiv(path string) (*goexiv.Image, error) {
	image, err := goexiv.Open(path)
	if err != nil {
		return nil, err
	}
	if err := image.ReadMetadata(); err != nil {
		runtime.KeepAlive(image)
		return nil, err
	}
	return image, nil
}

func compareCommonTags(t *testing.T, metadata model.ExifData, tags map[string]string) {
	t.Helper()
	if metadata.DateTimeOriginal != nil {
		got := tags["Exif.Photo.DateTimeOriginal"]
		want := metadata.DateTimeOriginal.Format("2006:01:02 15:04:05")
		if got != want {
			t.Errorf("DateTimeOriginal differs: go-exiftool=%q goexiv=%q", want, got)
		}
	}
	if metadata.OffsetTimeOriginal != "" {
		got := tags["Exif.Photo.OffsetTimeOriginal"]
		if got == "" {
			got = canonOffset(tags)
		}
		if got != "" && got != metadata.OffsetTimeOriginal {
			t.Errorf("OffsetTimeOriginal differs: go-exiftool=%q goexiv=%q", metadata.OffsetTimeOriginal, got)
		}
	}
	if metadata.GPSLatitude != nil && tags["Exif.GPSInfo.GPSLatitude"] == "" {
		t.Error("go-exiftool found GPS latitude but goexiv did not")
	}
	if metadata.GPSLongitude != nil && tags["Exif.GPSInfo.GPSLongitude"] == "" {
		t.Error("go-exiftool found GPS longitude but goexiv did not")
	}
}

func canonOffset(tags map[string]string) string {
	minutes, err := strconv.Atoi(tags["Exif.CanonTi.TimeZone"])
	if err != nil {
		return ""
	}
	sign := "+"
	if minutes < 0 {
		sign = "-"
		minutes = -minutes
	}
	return fmt.Sprintf("%s%02d:%02d", sign, minutes/60, minutes%60)
}

func isBMFF(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".cr3" || ext == ".hif"
}

func loadCorpus(t *testing.T) []fixture {
	t.Helper()

	entries, err := os.ReadDir(corpusDir)
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("read optional EXIF corpus: %v", err)
	}

	var fixtures []fixture
	for _, entry := range entries {
		if entry.IsDir() || !corpusExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			continue
		}
		fixtures = append(fixtures, fixture{
			name: entry.Name(),
			path: filepath.Join(corpusDir, entry.Name()),
		})
	}
	if len(fixtures) == 0 {
		t.Skipf("optional EXIF corpus is empty; add image files to %s to run comparison tests", corpusDir)
	}
	return fixtures
}

func assertTag(t *testing.T, tags map[string]string, key, want string) {
	t.Helper()
	if got := tags[key]; got != want {
		t.Errorf("%s = %q, want %q", key, got, want)
	}
}

func assertHasTag(t *testing.T, tags map[string]string, key string) {
	t.Helper()
	if tags[key] == "" {
		t.Errorf("missing EXIF tag %s", key)
	}
}

func hasTagSuffix(values map[string]any, suffix string) bool {
	for key := range values {
		if key == suffix || strings.HasSuffix(key, ":"+suffix) {
			return true
		}
	}
	return false
}

func copyFixture(t *testing.T, src string) string {
	t.Helper()
	dst := filepath.Join(t.TempDir(), filepath.Base(src))
	in, err := os.Open(src)
	if err != nil {
		t.Fatalf("open fixture %s: %v", src, err)
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		t.Fatalf("stat fixture %s: %v", src, err)
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		t.Fatalf("create temp image: %v", err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		t.Fatalf("copy fixture: %v", err)
	}
	if err := out.Close(); err != nil {
		t.Fatalf("close temp image: %v", err)
	}
	return dst
}
