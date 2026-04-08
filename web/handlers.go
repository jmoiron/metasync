package web

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/monet/mtr"

	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/scan"
	"github.com/jmoiron/metasync/store"
)

type PageConfig struct {
	Debug           bool
	TargetPath      string
	ReferencePath   string
	Recursive       bool
	RefreshMetadata bool
	Workers         int
	BatchSize       int
}

type InitialState struct {
	TargetPhotos    []model.Photo
	ReferencePhotos []model.Photo
	TargetError     error
	ReferenceError  error
}

type Handlers struct {
	reg     *mtr.Registry
	store   *store.Store
	cfg     PageConfig
	initial InitialState
}

func NewHandlers(reg *mtr.Registry, st *store.Store, cfg PageConfig, initial InitialState) *Handlers {
	return &Handlers{reg: reg, store: st, cfg: cfg, initial: initial}
}

func (h *Handlers) Index(w http.ResponseWriter, r *http.Request) {
	targetPath := firstNonEmpty(r.URL.Query().Get("target"), h.cfg.TargetPath)
	referencePath := firstNonEmpty(r.URL.Query().Get("ref"), h.cfg.ReferencePath)
	recursive := queryBool(r, "recursive", h.cfg.Recursive)

	targetPhotos, referencePhotos, targetErr, referenceErr := h.resolveScan(targetPath, referencePath, recursive)

	ctx := mtr.Ctx{
		"title": "metasync",
		"page": map[string]any{
			"Debug":            h.cfg.Debug,
			"TargetPath":       targetPath,
			"ReferencePath":    referencePath,
			"Recursive":        recursive,
			"TargetPhotos":     targetPhotos,
			"ReferencePhotos":  referencePhotos,
			"TargetSummary":    summarizePhotos(targetPath, targetPhotos, targetErr),
			"ReferenceSummary": summarizePhotos(referencePath, referencePhotos, referenceErr),
			"TargetError":      errString(targetErr),
			"ReferenceError":   errString(referenceErr),
		},
	}

	if err := h.reg.RenderWithBase(w, "base", "assets/templates/index.html", ctx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *Handlers) resolveScan(targetPath, referencePath string, recursive bool) ([]model.Photo, []model.Photo, error, error) {
	if targetPath == h.cfg.TargetPath && referencePath == h.cfg.ReferencePath && recursive == h.cfg.Recursive {
		return h.initial.TargetPhotos, h.initial.ReferencePhotos, h.initial.TargetError, h.initial.ReferenceError
	}

	var extractor *exif.Extractor
	if targetPath != "" || referencePath != "" {
		var err error
		extractor, err = exif.New()
		if err != nil {
			slog.Warn("failed to initialize exiftool; continuing without exif data", "err", err)
		} else {
			defer extractor.Close()
		}
	}

	targetPhotos, targetErr := scanIfPresent(targetPath, model.SideTarget, recursive, h.cfg.RefreshMetadata, extractor, h.store)
	referencePhotos, referenceErr := scanIfPresent(referencePath, model.SideReference, recursive, h.cfg.RefreshMetadata, extractor, h.store)
	return targetPhotos, referencePhotos, targetErr, referenceErr
}

func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
	})
}

type ApplyChangesRequest struct {
	Changes []ApplyFileChange `json:"changes"`
}

type ApplyFileChange struct {
	Path         string   `json:"path"`
	ExifTime     *string  `json:"exif_time,omitempty"`
	GPSLatitude  *float64 `json:"gps_latitude,omitempty"`
	GPSLongitude *float64 `json:"gps_longitude,omitempty"`
}

type ApplyError struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type ApplyChangesResponse struct {
	Applied []string     `json:"applied"`
	Errors  []ApplyError `json:"errors"`
}

func (h *Handlers) Apply(w http.ResponseWriter, r *http.Request) {
	var req ApplyChangesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	resp := ApplyChangesResponse{
		Applied: make([]string, 0, len(req.Changes)),
		Errors:  []ApplyError{},
	}
	if len(req.Changes) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	extractor, err := exif.New()
	if err != nil {
		http.Error(w, "failed to initialize exiftool", http.StatusInternalServerError)
		return
	}
	defer extractor.Close()

	for _, change := range req.Changes {
		if change.Path == "" {
			resp.Errors = append(resp.Errors, ApplyError{
				Path:  "",
				Error: "missing path",
			})
			continue
		}

		writeReq := exif.WriteRequest{
			GPSLatitude:  change.GPSLatitude,
			GPSLongitude: change.GPSLongitude,
		}
		if change.ExifTime != nil {
			t, parseErr := parsePreviewTime(*change.ExifTime)
			if parseErr != nil {
				resp.Errors = append(resp.Errors, ApplyError{
					Path:  change.Path,
					Error: "invalid exif_time format",
				})
				continue
			}
			writeReq.Time = &t
		}

		if writeReq.Time == nil && writeReq.GPSLatitude == nil && writeReq.GPSLongitude == nil {
			continue
		}

		if writeErr := extractor.Write(change.Path, writeReq); writeErr != nil {
			resp.Errors = append(resp.Errors, ApplyError{
				Path:  change.Path,
				Error: writeErr.Error(),
			})
			continue
		}
		resp.Applied = append(resp.Applied, change.Path)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func parsePreviewTime(value string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02 15:04:05", value, time.Local)
}

func scanIfPresent(root string, side model.Side, recursive bool, refreshMetadata bool, extractor *exif.Extractor, st *store.Store) ([]model.Photo, error) {
	if root == "" {
		return nil, nil
	}
	return scan.Photos(root, side, recursive, refreshMetadata, extractor, st)
}

func summarizePhotos(root string, photos []model.Photo, err error) string {
	switch {
	case root == "":
		return "No directory loaded"
	case err != nil:
		return fmt.Sprintf("Unable to load %s", filepath.Base(root))
	case len(photos) == 0:
		return "No supported image files found"
	case len(photos) == 1:
		return "1 image loaded"
	default:
		return fmt.Sprintf("%d images loaded", len(photos))
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func queryBool(r *http.Request, name string, fallback bool) bool {
	value := r.URL.Query().Get(name)
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "on", "yes":
		return true
	case "0", "false", "off", "no":
		return false
	default:
		return fallback
	}
}
