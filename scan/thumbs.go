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
