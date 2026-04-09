package scan

import (
	"fmt"
	"image"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/store"

	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/tiff"
)

var supportedExts = []string{
	".jpeg",
	".jpg",
	".png",
	".tif",
	".tiff",
	".arw",
	".cr2",
	".cr3",
	".crw",
	".nef",
	".nrw",
	".sr2",
	".srf",
}

func Supported(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return slices.Contains(supportedExts, ext)
}

func Photos(root string, side model.Side, recursive bool, refreshMetadata bool, extractor *exif.Extractor, st *store.Store) ([]model.Photo, error) {
	root = filepath.Clean(root)
	slog.Info("starting photo scan", "side", side, "root", root, "recursive", recursive, "refresh_metadata", refreshMetadata)

	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}

	photos := make([]model.Photo, 0, 128)
	found := 0
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if !recursive && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if !Supported(path) {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}

		photos = append(photos, model.Photo{
			Side:         side,
			Path:         path,
			RelativePath: rel,
			BaseName:     filepath.Base(path),
			Extension:    strings.ToLower(filepath.Ext(path)),
			Size:         info.Size(),
			ModTime:      info.ModTime(),
		})
		found++
		if found%100 == 0 {
			slog.Info("scan progress", "side", side, "found", found, "root", root)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	slog.Info("photo discovery complete", "side", side, "count", len(photos), "root", root)

	sort.Slice(photos, func(i, j int) bool {
		return photos[i].BaseName < photos[j].BaseName
	})

	paths := make([]string, 0, len(photos))
	uncached := make([]int, 0, len(photos))
	cacheHits := 0
	for i := range photos {
		photos[i].ID = idFor(side, photos[i].Path)
		if st != nil {
			photos[i].CacheKey = st.Hash(photos[i].Path, photos[i].ModTime)
			if !refreshMetadata {
				cached, ok, err := st.Lookup(photos[i].CacheKey)
				if err != nil {
					slog.Warn("cache lookup failed", "path", photos[i].Path, "err", err)
				} else if ok {
					photos[i].Exif = cached.Exif
					cacheHits++
					continue
				}
			}
		}
		uncached = append(uncached, i)
		paths = append(paths, photos[i].Path)
	}
	slog.Info("metadata cache status", "side", side, "hits", cacheHits, "misses", len(uncached), "root", root)

	exifData := map[string]model.ExifData{}
	if extractor != nil && len(paths) > 0 {
		extractStart := time.Now()
		exifData = extractor.Extract(paths)
		slog.Info(
			"exif extraction complete",
			"side", side,
			"count", len(paths),
			"elapsed", time.Since(extractStart).Round(time.Millisecond).String(),
			"root", root,
		)
	}
	var dimensionsElapsed time.Duration
	dimensionsCount := 0
	var upsertElapsed time.Duration
	upsertCount := 0
	for _, i := range uncached {
		if data, ok := exifData[photos[i].Path]; ok {
			photos[i].Exif = data
		}
		if photos[i].Exif.Width == 0 || photos[i].Exif.Height == 0 {
			dimStart := time.Now()
			dimensionsCount++
			photos[i].Exif.Width, photos[i].Exif.Height = dimensions(photos[i].Path)
			dimensionsElapsed += time.Since(dimStart)
		}
		if st != nil {
			upsertItemStart := time.Now()
			if err := st.Upsert(photos[i]); err != nil {
				slog.Warn("cache upsert failed", "path", photos[i].Path, "err", err)
			} else {
				upsertCount++
			}
			upsertElapsed += time.Since(upsertItemStart)
		}
	}
	slog.Info(
		"dimension fallback complete",
		"side", side,
		"count", dimensionsCount,
		"elapsed", dimensionsElapsed.Round(time.Millisecond).String(),
		"root", root,
	)
	if st != nil {
		slog.Info(
			"metadata cache upsert complete",
			"side", side,
			"count", upsertCount,
			"elapsed", upsertElapsed.Round(time.Millisecond).String(),
			"root", root,
		)
	}
	if st != nil {
		thumbStart := time.Now()
		if err := EnsureThumbnails(photos, st.CacheDir); err != nil {
			slog.Warn("thumbnail generation failed", "side", side, "root", root, "err", err)
		}
		slog.Info(
			"thumbnail ensure complete",
			"side", side,
			"count", len(photos),
			"elapsed", time.Since(thumbStart).Round(time.Millisecond).String(),
			"root", root,
		)
	}
	slog.Info("scan complete", "side", side, "count", len(photos), "root", root)

	return photos, nil
}

func idFor(side model.Side, path string) string {
	if side == "" {
		return path
	}
	return string(side) + ":" + path
}

func dimensions(path string) (int, int) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}
