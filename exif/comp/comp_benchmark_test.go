package comp

import (
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/jmoiron/etruscan"
	"github.com/jmoiron/metasync/exif"
	"github.com/kolesa-team/goexiv"
)

const (
	benchmarkDirEnv         = "METASYNC_EXIF_BENCH_DIR"
	benchmarkWorkersEnv     = "METASYNC_EXIF_BENCH_WORKERS"
	defaultBenchmarkWorkers = 4
)

var benchmarkImageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".tif": true,
	".tiff": true, ".webp": true, ".cr2": true, ".cr3": true, ".hif": true,
}

func BenchmarkReadCorpus(b *testing.B) {
	paths, err := findBenchmarkImages(corpusDir)
	if os.IsNotExist(err) || (err == nil && len(paths) == 0) {
		b.Skipf("optional EXIF corpus is empty; add image files to %s to run this benchmark", corpusDir)
	}
	if err != nil {
		b.Fatalf("scan optional EXIF corpus: %v", err)
	}
	benchmarkReaders(b, paths)
}

func BenchmarkReadDirectory(b *testing.B) {
	root := strings.TrimSpace(os.Getenv(benchmarkDirEnv))
	if root == "" {
		command := fmt.Sprintf("%s=/path/to/images go test ./exif/comp -run '^$' -bench BenchmarkReadDirectory -benchmem", benchmarkDirEnv)
		fmt.Fprintf(os.Stderr, "BenchmarkReadDirectory skipped: set %s to an image directory, for example:\n  %s\n", benchmarkDirEnv, command)
		b.Skipf("set %s to an image directory", benchmarkDirEnv)
	}
	paths, err := findBenchmarkImages(root)
	if err != nil {
		b.Fatalf("scan benchmark directory: %v", err)
	}
	if len(paths) == 0 {
		b.Skipf("no supported image files found under %s", root)
	}
	b.Logf("benchmark directory: %s (%d image files)", root, len(paths))
	benchmarkReaders(b, paths)
}

func TestFindBenchmarkImagesExcludesVideos(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{
		"still.jpg", "still.CR3", "clip.mp4", "clip.mov", "clip.mkv", "clip.avi", "clip.webm",
	} {
		if err := os.WriteFile(filepath.Join(root, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	paths, err := findBenchmarkImages(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 {
		t.Fatalf("found %d benchmark inputs, want 2 images: %v", len(paths), paths)
	}
	for _, path := range paths {
		ext := strings.ToLower(filepath.Ext(path))
		if !benchmarkImageExtensions[ext] {
			t.Errorf("non-image file included in benchmark inputs: %s", path)
		}
	}
}

func benchmarkReaders(b *testing.B, paths []string) {
	b.Helper()
	workers := benchmarkWorkerCount(b)

	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer slog.SetDefault(previousLogger)

	b.Run("GoExifTool", func(b *testing.B) {
		exif.Configure(workers, 4)
		if err := exif.ConfigureReader("go-exiftool"); err != nil {
			b.Fatalf("configure go-exiftool reader: %v", err)
		}
		extractor, err := exif.New()
		if err != nil {
			b.Fatalf("initialize go-exiftool: %v", err)
		}
		defer extractor.Close()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			results := extractor.Extract(paths)
			if len(results) != len(paths) {
				b.Fatalf("go-exiftool returned %d results for %d images", len(results), len(paths))
			}
		}
		b.ReportMetric(float64(b.Elapsed().Nanoseconds())/float64(b.N*len(paths)), "ns/image")
		b.ReportMetric(float64(len(paths)), "images/op")
		b.ReportMetric(float64(workers), "workers")
	})

	b.Run("Exiv2", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if err := readPathsParallel(paths, workers, func(path string) error {
				image, err := goexiv.Open(path)
				if err != nil {
					return fmt.Errorf("goexiv open %s: %w", path, err)
				}
				if err := image.ReadMetadata(); err != nil {
					runtime.KeepAlive(image)
					return fmt.Errorf("goexiv read %s: %w", path, err)
				}
				_ = image.GetExifData().AllTags()
				_ = image.GetIptcData().AllTags()
				_ = image.GetXmpData().AllTags()
				runtime.KeepAlive(image)
				return nil
			}); err != nil {
				b.Fatal(err)
			}
		}
		b.ReportMetric(float64(b.Elapsed().Nanoseconds())/float64(b.N*len(paths)), "ns/image")
		b.ReportMetric(float64(len(paths)), "images/op")
		b.ReportMetric(float64(workers), "workers")
	})

	b.Run("Etruscan", func(b *testing.B) {
		options := &etruscan.Options{Duplicates: true}
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if err := readPathsParallel(paths, workers, func(path string) error {
				metadata, err := etruscan.Read(path, options)
				if err != nil {
					return fmt.Errorf("etruscan read %s: %w", path, err)
				}
				runtime.KeepAlive(metadata)
				return nil
			}); err != nil {
				b.Fatal(err)
			}
		}
		b.ReportMetric(float64(b.Elapsed().Nanoseconds())/float64(b.N*len(paths)), "ns/image")
		b.ReportMetric(float64(len(paths)), "images/op")
		b.ReportMetric(float64(workers), "workers")
	})
}

func benchmarkWorkerCount(b *testing.B) int {
	b.Helper()
	value := strings.TrimSpace(os.Getenv(benchmarkWorkersEnv))
	if value == "" {
		return defaultBenchmarkWorkers
	}
	workers, err := strconv.Atoi(value)
	if err != nil || workers < 1 {
		b.Fatalf("%s must be a positive integer, got %q", benchmarkWorkersEnv, value)
	}
	return workers
}

func readPathsParallel(paths []string, workers int, read func(string) error) error {
	type job struct {
		index int
		path  string
	}
	jobs := make(chan job)
	errs := make([]error, len(paths))

	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for item := range jobs {
				errs[item.index] = read(item.path)
			}
		}()
	}
	go func() {
		defer close(jobs)
		for i, path := range paths {
			jobs <- job{index: i, path: path}
		}
	}()
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func findBenchmarkImages(root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !benchmarkImageExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", root, err)
	}
	sort.Strings(paths)
	return paths, nil
}
