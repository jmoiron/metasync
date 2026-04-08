package exif

import (
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"

	exiftool "github.com/barasher/go-exiftool"

	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/spool"
)

type Extractor struct {
	et *exiftool.Exiftool
}

const (
	defaultExtractChunkSize = 64
	defaultExtractWorkers   = 4
)

var (
	extractChunkSize = defaultExtractChunkSize
	extractWorkers   = defaultExtractWorkers
)

type extractJob struct {
	paths []string
}

type extractResult struct {
	data map[string]model.ExifData
}

type WriteRequest struct {
	Time         *time.Time
	GPSLatitude  *float64
	GPSLongitude *float64
}

func Configure(workers, batchSize int) {
	if workers > 0 {
		extractWorkers = workers
	} else {
		extractWorkers = defaultExtractWorkers
	}
	if batchSize > 0 {
		extractChunkSize = batchSize
	} else {
		extractChunkSize = defaultExtractChunkSize
	}
}

func New() (*Extractor, error) {
	et, err := newExiftool()
	if err != nil {
		return nil, err
	}
	return &Extractor{et: et}, nil
}

func newExiftool() (*exiftool.Exiftool, error) {
	buf := make([]byte, 256*1024)
	return exiftool.NewExiftool(
		exiftool.NoPrintConversion(),
		exiftool.Buffer(buf, 16*1024*1024),
	)
}

func (e *Extractor) Close() error {
	if e == nil || e.et == nil {
		return nil
	}
	return e.et.Close()
}

func (e *Extractor) Extract(paths []string) map[string]model.ExifData {
	result := make(map[string]model.ExifData, len(paths))
	if e == nil || e.et == nil || len(paths) == 0 {
		return result
	}

	jobs := make([]extractJob, 0, (len(paths)+extractChunkSize-1)/extractChunkSize)
	for start := 0; start < len(paths); start += extractChunkSize {
		end := start + extractChunkSize
		if end > len(paths) {
			end = len(paths)
		}
		jobs = append(jobs, extractJob{paths: paths[start:end]})
	}

	if extractWorkers <= 1 || len(jobs) <= 1 {
		return e.extractSingle(jobs, len(paths))
	}
	return e.extractParallel(jobs, len(paths))
}

func (e *Extractor) extractSingle(jobs []extractJob, total int) map[string]model.ExifData {
	result := make(map[string]model.ExifData, total)
	start := time.Now()
	done := 0
	for _, job := range jobs {
		mergeExtractResult(result, extractChunkWithExiftool(e.et, job.paths))
		done += len(job.paths)
		logExtractProgress(start, done, total)
	}
	return result
}

func (e *Extractor) extractParallel(jobs []extractJob, total int) map[string]model.ExifData {
	result := make(map[string]model.ExifData, total)
	pool := spool.NewPool(extractWorkers)
	jobch := make(chan extractJob, extractWorkers)
	progress := make(chan extractResult, extractWorkers)

	pool.Do(func() {
		et, err := newExiftool()
		if err != nil {
			for job := range jobch {
				progress <- extractResult{data: zeroExtractResult(job.paths)}
				pool.Err(fmt.Errorf("exiftool init failed: %w", err))
			}
			return
		}
		defer et.Close()

		for job := range jobch {
			progress <- extractResult{data: extractChunkWithExiftool(et, job.paths)}
		}
	})

	go func() {
		for _, job := range jobs {
			jobch <- job
		}
		close(jobch)
	}()

	start := time.Now()
	done := 0
	for range len(jobs) {
		res := <-progress
		mergeExtractResult(result, res.data)
		done += len(res.data)
		logExtractProgress(start, done, total)
	}

	if err := errors.Join(pool.Wait()...); err != nil {
		slog.Warn("parallel exif extraction encountered errors", "err", err)
	}
	return result
}

func extractChunkWithExiftool(et *exiftool.Exiftool, paths []string) map[string]model.ExifData {
	result := make(map[string]model.ExifData, len(paths))
	if et == nil || len(paths) == 0 {
		return result
	}

	seen := make(map[string]struct{}, len(paths))
	for _, file := range et.ExtractMetadata(paths...) {
		seen[file.File] = struct{}{}
		if file.Err != nil {
			slog.Warn("exif metadata extraction failed", "path", file.File, "err", file.Err)
			result[file.File] = model.ExifData{}
			continue
		}
		result[file.File] = normalize(file)
	}
	missing := 0
	for _, path := range paths {
		if _, ok := seen[path]; ok {
			continue
		}
		missing++
		slog.Warn("exif metadata missing from batch response", "path", path)
		result[path] = model.ExifData{}
	}
	return result
}

func logExtractProgress(start time.Time, completed, total int) {
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
		"exif extraction progress",
		"done", completed,
		"total", total,
		"images_per_sec", fmt.Sprintf("%.2f", rate),
		"elapsed", elapsed.Round(time.Second).String(),
		"remaining", remaining.Round(time.Second).String(),
	)
}

func mergeExtractResult(dst, src map[string]model.ExifData) {
	for path, data := range src {
		dst[path] = data
	}
}

func zeroExtractResult(paths []string) map[string]model.ExifData {
	result := make(map[string]model.ExifData, len(paths))
	for _, path := range paths {
		result[path] = model.ExifData{}
	}
	return result
}

func (e *Extractor) Write(path string, req WriteRequest) error {
	if e == nil || e.et == nil {
		return fmt.Errorf("exif extractor is not initialized")
	}

	md := exiftool.EmptyFileMetadata()
	md.File = path

	if req.Time != nil {
		ts := req.Time.Format("2006:01:02 15:04:05")
		offset := req.Time.Format("-07:00")
		md.SetString("DateTimeOriginal", ts)
		md.SetString("CreateDate", ts)
		md.SetString("ModifyDate", ts)
		md.SetString("OffsetTimeOriginal", offset)
		md.SetString("OffsetTimeDigitized", offset)
		md.SetString("OffsetTime", offset)
	}

	if req.GPSLatitude != nil {
		md.SetFloat("GPSLatitude", math.Abs(*req.GPSLatitude))
		if *req.GPSLatitude < 0 {
			md.SetString("GPSLatitudeRef", "S")
		} else {
			md.SetString("GPSLatitudeRef", "N")
		}
	}
	if req.GPSLongitude != nil {
		md.SetFloat("GPSLongitude", math.Abs(*req.GPSLongitude))
		if *req.GPSLongitude < 0 {
			md.SetString("GPSLongitudeRef", "W")
		} else {
			md.SetString("GPSLongitudeRef", "E")
		}
	}

	items := []exiftool.FileMetadata{md}
	e.et.WriteMetadata(items)
	return items[0].Err
}

func normalize(file exiftool.FileMetadata) model.ExifData {
	return model.ExifData{
		DateTimeOriginal: firstTime(file, "DateTimeOriginal", "SubSecDateTimeOriginal"),
		CreateDate:       firstTime(file, "CreateDate", "SubSecCreateDate"),
		ModifyDate:       firstTime(file, "ModifyDate"),
		GPSLatitude:      firstGPSCoordinate(file, "GPSLatitude", "GPSLatitudeRef", "N", "S"),
		GPSLongitude:     firstGPSCoordinate(file, "GPSLongitude", "GPSLongitudeRef", "E", "W"),
		Width:            firstInt(file, "ImageWidth", "ExifImageWidth", "SourceImageWidth"),
		Height:           firstInt(file, "ImageHeight", "ExifImageHeight", "SourceImageHeight"),
		Aperture:         firstFloat(file, "Aperture", "FNumber"),
		Exposure:         firstString(file, "ExposureTime", "ShutterSpeed"),
		FocalLength:      firstFloat(file, "FocalLength"),
		ISO:              firstIntPtr(file, "ISO"),
		MeteringMode:     firstString(file, "MeteringMode"),
		CameraModel:      firstString(file, "Model"),
	}
}

func firstTime(file exiftool.FileMetadata, keys ...string) *time.Time {
	for _, key := range keys {
		value, err := file.GetString(key)
		if err != nil || value == "" {
			continue
		}
		if t, ok := parseTime(value); ok {
			return &t
		}
	}
	return nil
}

func firstFloat(file exiftool.FileMetadata, keys ...string) *float64 {
	for _, key := range keys {
		value, err := file.GetFloat(key)
		if err == nil {
			return &value
		}

		s, err := file.GetString(key)
		if err != nil || s == "" {
			continue
		}
		if v, ok := parseFloatString(s); ok {
			return &v
		}
	}
	return nil
}

func firstGPSCoordinate(file exiftool.FileMetadata, valueKey, refKey, positiveRef, negativeRef string) *float64 {
	value := firstFloat(file, valueKey)
	if value == nil {
		return nil
	}

	ref := strings.ToUpper(firstString(file, refKey))
	v := *value
	switch ref {
	case negativeRef:
		v = -math.Abs(v)
	case positiveRef:
		v = math.Abs(v)
	}
	return &v
}

func firstInt(file exiftool.FileMetadata, keys ...string) int {
	for _, key := range keys {
		value, err := file.GetInt(key)
		if err == nil {
			return int(value)
		}

		s, err := file.GetString(key)
		if err != nil || s == "" {
			continue
		}
		if v, ok := parseIntString(s); ok {
			return v
		}
	}
	return 0
}

func firstIntPtr(file exiftool.FileMetadata, keys ...string) *int {
	for _, key := range keys {
		value, err := file.GetInt(key)
		if err == nil {
			v := int(value)
			return &v
		}

		s, err := file.GetString(key)
		if err != nil || s == "" {
			continue
		}
		if v, ok := parseIntString(s); ok {
			return &v
		}
	}
	return nil
}

func firstString(file exiftool.FileMetadata, keys ...string) string {
	for _, key := range keys {
		s, err := file.GetString(key)
		if err == nil && s != "" {
			return s
		}
	}
	return ""
}

func parseTime(value string) (time.Time, bool) {
	layouts := []string{
		"2006:01:02 15:04:05.999999999-07:00",
		"2006:01:02 15:04:05-07:00",
		"2006:01:02 15:04:05.999999999",
		"2006:01:02 15:04:05",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func parseFloatString(value string) (float64, bool) {
	value = strings.TrimSpace(value)
	sign := 1.0
	switch {
	case strings.HasSuffix(value, " S"), strings.HasSuffix(value, " W"):
		sign = -1
	}
	value = strings.TrimSuffix(value, " N")
	value = strings.TrimSuffix(value, " S")
	value = strings.TrimSuffix(value, " E")
	value = strings.TrimSuffix(value, " W")
	value = strings.TrimSpace(value)
	v, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, false
	}
	return sign * v, true
}

func parseIntString(value string) (int, bool) {
	value = strings.TrimSpace(value)
	v, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return v, true
}
