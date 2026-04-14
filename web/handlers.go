package web

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/monet/mtr"

	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/scan"
	"github.com/jmoiron/metasync/store"
	"github.com/jmoiron/metasync/xplat"
)

type PageConfig struct {
	Debug             bool
	TargetPaths       []string
	ReferencePaths    []string
	DefaultBrowsePath string
	Recursive         bool
	RefreshMetadata   bool
	Workers           int
	BatchSize         int
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

type DirectorySelectorState struct {
	Path      string
	Separator string
	Segments  []xplat.PathSegment
	Entries   []xplat.DirectoryEntry
	Error     string
}

type DirectoryBrowseResponse struct {
	Path      string                 `json:"path"`
	Separator string                 `json:"separator"`
	Segments  []xplat.PathSegment    `json:"segments"`
	Entries   []xplat.DirectoryEntry `json:"entries"`
	Error     string                 `json:"error,omitempty"`
}

func NewHandlers(reg *mtr.Registry, st *store.Store, cfg PageConfig, initial InitialState) *Handlers {
	return &Handlers{reg: reg, store: st, cfg: cfg, initial: initial}
}

func (h *Handlers) Index(w http.ResponseWriter, r *http.Request) {
	targetPaths := firstNonEmptyList(queryList(r, "target"), h.cfg.TargetPaths)
	referencePaths := firstNonEmptyList(queryList(r, "ref"), h.cfg.ReferencePaths)
	recursive := queryBool(r, "recursive", h.cfg.Recursive)
	targetSelector := h.selectorState(firstPath(targetPaths))
	referenceSelector := h.selectorState(firstPath(referencePaths))

	targetPhotos, referencePhotos, targetErr, referenceErr := h.resolveScan(targetPaths, referencePaths, recursive)

	ctx := mtr.Ctx{
		"title": "metasync",
		"page": map[string]any{
			"Debug":             h.cfg.Debug,
			"TargetPaths":       targetPaths,
			"ReferencePaths":    referencePaths,
			"Recursive":         recursive,
			"TargetPhotos":      targetPhotos,
			"ReferencePhotos":   referencePhotos,
			"TargetSelector":    targetSelector,
			"ReferenceSelector": referenceSelector,
			"TargetSummary":     summarizePhotos(targetPaths, targetPhotos, targetErr),
			"ReferenceSummary":  summarizePhotos(referencePaths, referencePhotos, referenceErr),
			"TargetError":       errString(targetErr),
			"ReferenceError":    errString(referenceErr),
		},
	}

	if err := h.reg.RenderWithBase(w, "base", "assets/templates/index.html", ctx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (h *Handlers) BrowseDirectories(w http.ResponseWriter, r *http.Request) {
	result, err := xplat.BrowseDirectories(
		firstNonEmpty(r.URL.Query().Get("path"), h.cfg.DefaultBrowsePath),
		xplat.BrowseOptions{
			ShowFiles:       queryBool(r, "show_files", false),
			ShowHiddenPaths: queryBool(r, "show_hidden", false),
		},
	)
	resp := DirectoryBrowseResponse{
		Path:      result.Path,
		Separator: result.Separator,
		Segments:  result.Segments,
		Entries:   result.Entries,
	}
	if err != nil {
		resp.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handlers) resolveScan(targetPaths, referencePaths []string, recursive bool) ([]model.Photo, []model.Photo, error, error) {
	if slices.Equal(targetPaths, h.cfg.TargetPaths) && slices.Equal(referencePaths, h.cfg.ReferencePaths) && recursive == h.cfg.Recursive {
		return h.initial.TargetPhotos, h.initial.ReferencePhotos, h.initial.TargetError, h.initial.ReferenceError
	}

	var extractor *exif.Extractor
	if len(targetPaths) > 0 || len(referencePaths) > 0 {
		var err error
		extractor, err = exif.New()
		if err != nil {
			slog.Warn("failed to initialize exiftool; continuing without exif data", "err", err)
		} else {
			defer extractor.Close()
		}
	}

	targetPhotos, targetErr := scanIfPresent(targetPaths, model.SideTarget, recursive, h.cfg.RefreshMetadata, extractor, h.store)
	referencePhotos, referenceErr := scanIfPresent(referencePaths, model.SideReference, recursive, h.cfg.RefreshMetadata, extractor, h.store)
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
	ExifOffset   *string  `json:"exif_offset,omitempty"`
	GPSTime      *string  `json:"gps_time,omitempty"`
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

type InspectExifResponse struct {
	Path string         `json:"path"`
	Data map[string]any `json:"data"`
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

	writes := make([]exif.FileWrite, 0, len(req.Changes))
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
		if change.ExifTime != nil || change.ExifOffset != nil {
			t, parseErr := parsePreviewTime(firstNonEmptyPtr(change.ExifTime), firstNonEmptyPtr(change.ExifOffset))
			if parseErr != nil {
				resp.Errors = append(resp.Errors, ApplyError{
					Path:  change.Path,
					Error: "invalid exif time/offset format",
				})
				continue
			}
			writeReq.Time = &t
		}
		if change.GPSTime != nil {
			t, parseErr := parseGPSTime(*change.GPSTime)
			if parseErr != nil {
				resp.Errors = append(resp.Errors, ApplyError{
					Path:  change.Path,
					Error: "invalid gps_time format",
				})
				continue
			}
			writeReq.GPSTime = &t
		}

		if writeReq.Time == nil && writeReq.GPSTime == nil && writeReq.GPSLatitude == nil && writeReq.GPSLongitude == nil {
			continue
		}
		writes = append(writes, exif.FileWrite{
			Path: change.Path,
			Req:  writeReq,
		})
	}

	for _, result := range extractor.WriteAll(writes) {
		if result.Err != nil {
			resp.Errors = append(resp.Errors, ApplyError{
				Path:  result.Path,
				Error: result.Err.Error(),
			})
			continue
		}
		resp.Applied = append(resp.Applied, result.Path)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handlers) InspectExif(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	data, err := exif.Full(r.Context(), path)
	if err != nil {
		http.Error(w, "failed to load exif data", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(InspectExifResponse{
		Path: path,
		Data: nestExifData(data),
	})
}

func nestExifData(data map[string]any) map[string]any {
	root := make(map[string]any)
	for key, value := range data {
		parts := strings.Split(key, ":")
		cursor := root
		for i, part := range parts {
			if i == len(parts)-1 {
				cursor[part] = value
				continue
			}
			next, ok := cursor[part]
			if !ok {
				child := make(map[string]any)
				cursor[part] = child
				cursor = child
				continue
			}
			child, ok := next.(map[string]any)
			if !ok {
				child = map[string]any{
					"_value": next,
				}
				cursor[part] = child
			}
			cursor = child
		}
	}
	return root
}

func parsePreviewTime(value, offset string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("missing exif_time")
	}
	if offset != "" {
		return time.Parse("2006-01-02 15:04:05 -07:00", value+" "+offset)
	}
	return time.ParseInLocation("2006-01-02 15:04:05", value, time.Local)
}

func parseGPSTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("missing gps_time")
	}
	return time.Parse(time.RFC3339Nano, value)
}

func firstNonEmptyPtr(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func scanIfPresent(roots []string, side model.Side, recursive bool, refreshMetadata bool, extractor *exif.Extractor, st *store.Store) ([]model.Photo, error) {
	if len(roots) == 0 {
		return nil, nil
	}
	return scan.Photos(roots, side, recursive, refreshMetadata, extractor, st)
}

func summarizePhotos(roots []string, photos []model.Photo, err error) string {
	switch {
	case len(roots) == 0:
		return "No directory loaded"
	case err != nil:
		return fmt.Sprintf("Unable to load %s", summarizeRoots(roots))
	case len(photos) == 0:
		return "No supported image files found"
	case len(photos) == 1:
		return "1 image loaded"
	default:
		return fmt.Sprintf("%d images loaded", len(photos))
	}
}

func summarizeRoots(roots []string) string {
	if len(roots) == 1 {
		return filepath.Base(roots[0])
	}
	return fmt.Sprintf("%d directories", len(roots))
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

func firstPath(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func firstNonEmptyList(values []string, fallback []string) []string {
	if len(values) > 0 {
		return values
	}
	return fallback
}

func queryList(r *http.Request, name string) []string {
	values := r.URL.Query()[name]
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	return out
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

func (h *Handlers) selectorState(path string) DirectorySelectorState {
	result, err := xplat.BrowseDirectories(firstNonEmpty(path, h.cfg.DefaultBrowsePath), xplat.BrowseOptions{})
	return DirectorySelectorState{
		Path:      result.Path,
		Separator: result.Separator,
		Segments:  result.Segments,
		Entries:   result.Entries,
		Error:     errString(err),
	}
}
