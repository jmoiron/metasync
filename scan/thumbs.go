package scan

import (
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/progress"
	"github.com/jmoiron/metasync/scan/img"
)

const (
	ThumbMaxWidth  = img.ThumbMaxWidth
	ThumbMaxHeight = img.ThumbMaxHeight
)

func IsRawPath(path string) bool {
	return img.IsRawPath(path)
}

func EnsureRawPreview(srcPath, cacheDir, cacheKey string) (string, error) {
	return img.EnsureRawPreview(srcPath, cacheDir, cacheKey)
}

func Configure(workers int) {
	img.Configure(workers)
}

func ThumbnailGo(srcPath, dstPath string) error {
	return img.ThumbnailGo(srcPath, dstPath)
}

func ThumbnailConvert(srcPath, dstPath string) error {
	return img.ThumbnailConvert(srcPath, dstPath)
}

func EnsureThumbnails(photos []model.Photo, cacheDir string, reporter progress.Reporter) error {
	return img.EnsureThumbnails(photos, cacheDir, reporter)
}
