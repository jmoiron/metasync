package img

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	RawPreviewMaxWidth  = 1600
	RawPreviewMaxHeight = 1200
)

var browserViewableExts = map[string]struct{}{
	".jpg":  {},
	".jpeg": {},
	".png":  {},
	".gif":  {},
	".webp": {},
	".avif": {},
	".bmp":  {},
}

var rawExts = map[string]struct{}{
	".arw": {},
	".cr2": {},
	".cr3": {},
	".crw": {},
	".nef": {},
	".nrw": {},
	".sr2": {},
	".srf": {},
}

func IsRawPath(path string) bool {
	_, ok := rawExts[strings.ToLower(filepath.Ext(path))]
	return ok
}

func RawPreviewRelPath(cacheKey string) string {
	if cacheKey == "" {
		return ""
	}
	return cacheKey + ".raw.jpg"
}

func IsBrowserViewablePath(path string) bool {
	_, ok := browserViewableExts[strings.ToLower(filepath.Ext(path))]
	return ok
}

func PreviewRelPath(cacheKey string, maxBytes int64, maxWidth, maxHeight int) string {
	if cacheKey == "" {
		return ""
	}
	return cacheKey + ".preview." + strconv.FormatInt(maxBytes, 10) + "." + strconv.Itoa(maxWidth) + "x" + strconv.Itoa(maxHeight) + ".jpg"
}

func EnsurePreview(srcPath, cacheDir, cacheKey string, maxBytes int64, maxWidth, maxHeight int) (string, error) {
	if cacheDir == "" {
		return "", fmt.Errorf("missing cache dir")
	}
	if cacheKey == "" {
		return "", fmt.Errorf("missing cache key")
	}
	if maxWidth <= 0 || maxHeight <= 0 {
		return "", fmt.Errorf("invalid preview bounds")
	}

	dstPath := filepath.Join(cacheDir, PreviewRelPath(cacheKey, maxBytes, maxWidth, maxHeight))
	if _, err := os.Stat(dstPath); err == nil {
		return dstPath, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return "", err
	}

	tmp, err := os.CreateTemp(cacheDir, cacheKey+".preview-*.jpg")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer os.Remove(tmpPath)

	geometry := fmt.Sprintf("%dx%d>", maxWidth, maxHeight)
	cmd := exec.Command(
		"convert",
		srcPath,
		"-auto-orient",
		"-filter", "Catrom",
		"-resize", geometry,
		"-quality", "88",
		tmpPath,
	)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, dstPath); err != nil {
		return "", err
	}
	return dstPath, nil
}

func EnsureRawPreview(srcPath, cacheDir, cacheKey string) (string, error) {
	if cacheDir == "" {
		return "", fmt.Errorf("missing cache dir")
	}
	if cacheKey == "" {
		return "", fmt.Errorf("missing cache key")
	}

	dstPath := filepath.Join(cacheDir, RawPreviewRelPath(cacheKey))
	if _, err := os.Stat(dstPath); err == nil {
		return dstPath, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return "", err
	}

	tmp, err := os.CreateTemp(cacheDir, cacheKey+".raw-preview-*.jpg")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer os.Remove(tmpPath)

	geometry := fmt.Sprintf("%dx%d>", RawPreviewMaxWidth, RawPreviewMaxHeight)
	cmd := exec.Command(
		"convert",
		srcPath,
		"-auto-orient",
		"-filter", "Catrom",
		"-resize", geometry,
		"-quality", "88",
		tmpPath,
	)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, dstPath); err != nil {
		return "", err
	}
	return dstPath, nil
}
