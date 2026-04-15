package img

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	exiftool "github.com/barasher/go-exiftool"
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/progress"
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

func EnsureThumbnails(photos []model.Photo, cacheDir string, reporter progress.Reporter) error {
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
		return ensureThumbnailsSingle(jobs, cacheDir, reporter)
	}
	return ensureThumbnailsParallel(jobs, cacheDir, thumbWorkers, reporter)
}

func ensureThumbnailsSingle(jobs []thumbJob, cacheDir string, reporter progress.Reporter) error {
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
		if reporter != nil {
			reporter.Set(i + 1)
		}
		logThumbProgress(start, i+1, total)
	}
	return nil
}

func ensureThumbnailsParallel(jobs []thumbJob, cacheDir string, workers int, reporter progress.Reporter) error {
	total := len(jobs)

	slog.Info("starting thumbnail generation", "count", total, "cache_dir", cacheDir, "mode", "parallel", "workers", workers)

	pool := spool.NewPool(workers)
	jobch := make(chan thumbJob, workers)
	progressCh := make(chan struct{}, workers)

	pool.Do(func() {
		et, err := newBinaryExiftool()
		if err != nil {
			for job := range jobch {
				progressCh <- struct{}{}
				pool.Err(fmt.Errorf("creating thumbnail %s: exiftool init failed: %w", job.src, err))
			}
			return
		}
		defer et.Close()
		for job := range jobch {
			pool.Err(createThumbnailWithExiftool(et, job))
			progressCh <- struct{}{}
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
		<-progressCh
		if reporter != nil {
			reporter.Set(done + 1)
		}
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

	orientation, _ := orientationValue(items[0])

	for _, tag := range []string{"ThumbnailImage", "PreviewImage", "JpgFromRaw"} {
		buf, ok := binaryField(items[0], tag)
		if !ok || len(buf) == 0 {
			continue
		}
		if _, _, err := image.DecodeConfig(bytes.NewReader(buf)); err != nil {
			continue
		}
		if orientation >= 2 && orientation <= 8 {
			oriented, err := withJPEGOrientation(buf, orientation)
			if err != nil {
				return false, err
			}
			buf = oriented
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

func orientationValue(item exiftool.FileMetadata) (int, bool) {
	raw, ok := item.Fields["Orientation"]
	if !ok || raw == nil {
		return 0, false
	}
	switch v := raw.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		trimmed := strings.TrimSpace(v)
		if n, err := strconv.Atoi(trimmed); err == nil {
			return n, true
		}
		switch strings.ToLower(trimmed) {
		case "horizontal (normal)":
			return 1, true
		case "mirror horizontal":
			return 2, true
		case "rotate 180":
			return 3, true
		case "mirror vertical":
			return 4, true
		case "mirror horizontal and rotate 270 cw":
			return 5, true
		case "rotate 90 cw":
			return 6, true
		case "mirror horizontal and rotate 90 cw":
			return 7, true
		case "rotate 270 cw":
			return 8, true
		}
	}
	return 0, false
}

func withJPEGOrientation(jpegData []byte, orientation int) ([]byte, error) {
	if len(jpegData) < 4 || jpegData[0] != 0xff || jpegData[1] != 0xd8 {
		return nil, fmt.Errorf("thumbnail preview is not a jpeg")
	}
	exifBlock, err := minimalOrientationAPP1(orientation)
	if err != nil {
		return nil, err
	}

	out := make([]byte, 0, len(jpegData)+len(exifBlock))
	out = append(out, jpegData[0], jpegData[1])

	i := 2
	inserted := false
	for i < len(jpegData) {
		if jpegData[i] != 0xff {
			out = append(out, jpegData[i:]...)
			break
		}
		for i < len(jpegData) && jpegData[i] == 0xff {
			i++
		}
		if i >= len(jpegData) {
			break
		}
		marker := jpegData[i]
		i++

		if marker == 0xda {
			if !inserted {
				out = append(out, exifBlock...)
				inserted = true
			}
			out = append(out, 0xff, marker)
			out = append(out, jpegData[i:]...)
			break
		}

		if marker == 0xd8 || marker == 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker == 0x01 {
			out = append(out, 0xff, marker)
			continue
		}
		if i+2 > len(jpegData) {
			return nil, fmt.Errorf("invalid jpeg segment")
		}
		segLen := int(binary.BigEndian.Uint16(jpegData[i : i+2]))
		if segLen < 2 || i+segLen > len(jpegData) {
			return nil, fmt.Errorf("invalid jpeg segment length")
		}
		segmentStart := i - 2
		segmentEnd := i + segLen

		if !inserted && marker != 0xe0 {
			out = append(out, exifBlock...)
			inserted = true
		}

		if marker == 0xe1 && hasExifPrefix(jpegData[i+2:segmentEnd]) {
			i = segmentEnd
			continue
		}

		out = append(out, jpegData[segmentStart:segmentEnd]...)
		i = segmentEnd
	}

	if !inserted {
		out = append(out, exifBlock...)
	}

	return out, nil
}

func minimalOrientationAPP1(orientation int) ([]byte, error) {
	if orientation < 1 || orientation > 8 {
		return nil, fmt.Errorf("invalid orientation %d", orientation)
	}

	tiff := make([]byte, 0, 32)
	tiff = append(tiff, 'M', 'M', 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08)
	tiff = append(tiff, 0x00, 0x01)
	tiff = append(tiff, 0x01, 0x12) // Orientation
	tiff = append(tiff, 0x00, 0x03) // SHORT
	tiff = append(tiff, 0x00, 0x00, 0x00, 0x01)
	tiff = append(tiff, 0x00, byte(orientation), 0x00, 0x00)
	tiff = append(tiff, 0x00, 0x00, 0x00, 0x00)

	payload := append([]byte("Exif\x00\x00"), tiff...)
	if len(payload)+2 > 0xffff {
		return nil, fmt.Errorf("exif payload too large")
	}

	out := make([]byte, 0, len(payload)+4)
	out = append(out, 0xff, 0xe1)
	out = binary.BigEndian.AppendUint16(out, uint16(len(payload)+2))
	out = append(out, payload...)
	return out, nil
}

func hasExifPrefix(buf []byte) bool {
	return len(buf) >= 6 && string(buf[:6]) == "Exif\x00\x00"
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
