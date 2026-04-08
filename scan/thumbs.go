package scan

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	exiftool "github.com/barasher/go-exiftool"
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/spool"
	"golang.org/x/image/draw"
)

const (
	ThumbMaxWidth       = 160
	ThumbMaxHeight      = 160
	defaultThumbWorkers = 4
)

var thumbWorkers = defaultThumbWorkers

type thumbJob struct {
	src string
	dst string
}

type thumbResult struct {
	err error
}

func Configure(workers int) {
	if workers > 0 {
		thumbWorkers = workers
		return
	}
	thumbWorkers = defaultThumbWorkers
}

// ThumbnailGo produces a thumbnail in pure Go. It's about ~50% slower than using convert.
func ThumbnailGo(srcPath, dstPath string) error {
	f, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		return err
	}

	dstW, dstH := fitBox(src.Bounds().Dx(), src.Bounds().Dy(), ThumbMaxWidth, ThumbMaxHeight)
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer out.Close()

	return jpeg.Encode(out, dst, &jpeg.Options{Quality: 85})
}

// ThumbnailConvert is the default thumbnail path for metasync.
//
// We keep the pure-Go path for comparison and portability, but current local
// benchmarks favor ImageMagick convert by a clear margin. Sample benchmark run:
//
//	go test ./scan -bench Thumbnail -benchtime=1x
//
// BenchmarkThumbnailGoLarge-20             1  1261618700 ns/op
// BenchmarkThumbnailGoMed-20               1   311826048 ns/op
// BenchmarkThumbnailGoSmall-20             1   246753268 ns/op
// BenchmarkThumbnailConvertLarge-20        1   750550830 ns/op
// BenchmarkThumbnailConvertMed-20          1   134444064 ns/op
// BenchmarkThumbnailConvertSmall-20        1   133012809 ns/op
//
// Based on that, cached thumbnails are currently generated with convert.
func ThumbnailConvert(srcPath, dstPath string) error {
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}

	geometry := fmt.Sprintf("%dx%d>", ThumbMaxWidth, ThumbMaxHeight)
	cmd := exec.Command(
		"convert",
		srcPath,
		"-filter", "Catrom",
		"-resize", geometry,
		"-quality", "85",
		dstPath,
	)
	return cmd.Run()
}

func EnsureThumbnails(photos []model.Photo, cacheDir string) error {
	if cacheDir == "" {
		return nil
	}

	jobs := make([]thumbJob, 0, len(photos))
	for _, photo := range photos {
		if photo.CacheKey == "" {
			continue
		}
		dst := filepath.Join(cacheDir, photo.CacheKey+".jpg")
		if _, err := os.Stat(dst); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		jobs = append(jobs, thumbJob{src: photo.Path, dst: dst})
	}

	total := len(jobs)
	if total == 0 {
		return nil
	}

	if thumbWorkers <= 1 {
		return ensureThumbnailsSingle(jobs, cacheDir)
	}
	return ensureThumbnailsParallel(jobs, cacheDir, thumbWorkers)
}

func ensureThumbnailsSingle(jobs []thumbJob, cacheDir string) error {
	total := len(jobs)
	slog.Info("starting thumbnail generation", "count", total, "cache_dir", cacheDir, "mode", "single")

	et, err := newBinaryExiftool()
	if err != nil {
		return fmt.Errorf("thumbnail exiftool init: %w", err)
	}
	defer et.Close()

	start := time.Now()
	for i, job := range jobs {
		if err := createThumbnailWithExiftool(et, job); err != nil {
			return err
		}
		logThumbProgress(start, i+1, total)
	}
	return nil
}

func ensureThumbnailsParallel(jobs []thumbJob, cacheDir string, workers int) error {
	total := len(jobs)

	slog.Info("starting thumbnail generation", "count", total, "cache_dir", cacheDir, "mode", "parallel", "workers", workers)

	pool := spool.NewPool(workers)
	jobch := make(chan thumbJob, workers)
	progress := make(chan struct{}, workers)

	pool.Do(func() {
		et, err := newBinaryExiftool()

		// if we couldn't initialize an et, it's likely that none of the threads
		// will work; we should just drain the job channel so that we can error out
		if err != nil {
			for job := range jobch {
				progress <- struct{}{}
				pool.Err(fmt.Errorf("creating thumbnail %s: exiftool init failed: %w", job.src, err))
			}
			return
		}
		defer et.Close()
		for job := range jobch {
			pool.Err(createThumbnailWithExiftool(et, job))
			progress <- struct{}{}
		}
	})

	go func() {
		for _, job := range jobs {
			jobch <- job
		}
		close(jobch)
	}()

	start := time.Now()
	for done := range total {
		<-progress
		logThumbProgress(start, done+1, total)
	}

	return errors.Join(pool.Wait()...)
}

func logThumbProgress(start time.Time, completed, total int) {
	if completed%10 != 0 && completed != total {
		return
	}
	elapsed := time.Since(start)
	rate := float64(completed) / elapsed.Seconds()
	remainingCount := total - completed
	var remaining time.Duration
	if rate > 0 {
		remaining = time.Duration(float64(remainingCount)/rate) * time.Second
	}
	slog.Info(
		"thumbnail progress",
		"done", completed,
		"total", total,
		"images_per_sec", fmt.Sprintf("%.2f", rate),
		"elapsed", elapsed.Round(time.Second).String(),
		"remaining", remaining.Round(time.Second).String(),
	)
}

func createThumbnailWithExiftool(et *exiftool.Exiftool, job thumbJob) error {
	ok, err := thumbnailEmbeddedWithExiftool(et, job.src, job.dst)
	if err != nil {
		return fmt.Errorf("create thumbnail %s: %w", job.src, err)
	}
	if ok {
		return nil
	}
	if err := ThumbnailConvert(job.src, job.dst); err != nil {
		return fmt.Errorf("create thumbnail %s: %w", job.src, err)
	}
	return nil
}

func newBinaryExiftool() (*exiftool.Exiftool, error) {
	buf := make([]byte, 256*1024)
	return exiftool.NewExiftool(
		exiftool.NoPrintConversion(),
		exiftool.ExtractAllBinaryMetadata(),
		exiftool.Buffer(buf, 16*1024*1024),
	)
}

func thumbnailEmbeddedWithExiftool(et *exiftool.Exiftool, srcPath, dstPath string) (bool, error) {
	items := et.ExtractMetadata(srcPath)
	if len(items) == 0 {
		return false, nil
	}
	if items[0].Err != nil {
		return false, items[0].Err
	}
	for _, tag := range []string{"ThumbnailImage", "PreviewImage", "JpgFromRaw"} {
		buf, ok := binaryField(items[0], tag)
		if !ok || len(buf) == 0 {
			continue
		}
		if _, _, err := image.DecodeConfig(bytes.NewReader(buf)); err != nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
			return false, err
		}
		if err := os.WriteFile(dstPath, buf, 0o644); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

func binaryField(item exiftool.FileMetadata, key string) ([]byte, bool) {
	raw, ok := item.Fields[key]
	if !ok || raw == nil {
		return nil, false
	}
	switch v := raw.(type) {
	case []byte:
		return v, true
	case string:
		if v == "" {
			return nil, false
		}
		trimmed := strings.TrimSpace(v)
		if strings.HasPrefix(trimmed, "base64") {
			trimmed = strings.TrimPrefix(trimmed, "base64")
			trimmed = strings.TrimPrefix(trimmed, ":")
			trimmed = strings.TrimSpace(trimmed)
		}
		decoded, err := base64.StdEncoding.DecodeString(trimmed)
		if err != nil {
			return nil, false
		}
		return decoded, true
	default:
		return nil, false
	}
}

func fitBox(srcW, srcH, maxW, maxH int) (int, int) {
	if srcW <= 0 || srcH <= 0 {
		return 1, 1
	}
	if srcW <= maxW && srcH <= maxH {
		return srcW, srcH
	}

	scaleW := float64(maxW) / float64(srcW)
	scaleH := float64(maxH) / float64(srcH)
	scale := min(scaleW, scaleH)

	w := max(1, int(float64(srcW)*scale+0.5))
	h := max(1, int(float64(srcH)*scale+0.5))
	return w, h
}
