package web

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/monet/mtr"

	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/progress"
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
	hub     *progress.Hub
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

type HeaderPathSegment struct {
	Label     string
	Path      string
	URL       string
	Current   bool
	Clickable bool
}

func NewHandlers(reg *mtr.Registry, st *store.Store, cfg PageConfig, initial InitialState, hub *progress.Hub) *Handlers {
	return &Handlers{reg: reg, store: st, cfg: cfg, initial: initial, hub: hub}
}

func (h *Handlers) Index(w http.ResponseWriter, r *http.Request) {
	pageID := newID()
	targetPaths := firstNonEmptyList(queryList(r, "target"), h.cfg.TargetPaths)
	referencePaths := firstNonEmptyList(queryList(r, "ref"), h.cfg.ReferencePaths)
	recursive := queryBool(r, "recursive", h.cfg.Recursive)
	targetBrowser := queryBool(r, "target_browser", false)
	referenceBrowser := queryBool(r, "ref_browser", false)
	targetSelector := h.selectorState(firstPath(targetPaths))
	referenceSelector := h.selectorState(firstPath(referencePaths))

	scanTargetPaths := targetPaths
	if targetBrowser {
		scanTargetPaths = nil
	}
	scanReferencePaths := referencePaths
	if referenceBrowser {
		scanReferencePaths = nil
	}

	targetPhotos, referencePhotos, targetErr, referenceErr := h.resolveScan(scanTargetPaths, scanReferencePaths, recursive)

	ctx := mtr.Ctx{
		"title": "metasync",
		"page": map[string]any{
			"PageID":               pageID,
			"Debug":                h.cfg.Debug,
			"TargetPaths":          targetPaths,
			"ReferencePaths":       referencePaths,
			"Recursive":            recursive,
			"TargetPhotos":         targetPhotos,
			"ReferencePhotos":      referencePhotos,
			"TargetBrowser":        targetBrowser,
			"ReferenceBrowser":     referenceBrowser,
			"TargetSelector":       targetSelector,
			"ReferenceSelector":    referenceSelector,
			"TargetSummary":        summarizePhotos(targetPaths, targetPhotos, targetErr),
			"ReferenceSummary":     summarizePhotos(referencePaths, referencePhotos, referenceErr),
			"TargetError":          errString(targetErr),
			"ReferenceError":       errString(referenceErr),
			"TargetDirPath":        firstPath(targetPaths),
			"ReferenceDirPath":     firstPath(referencePaths),
			"TargetDirSegments":    headerPathSegments(r, "target", "target_browser", firstPath(targetPaths)),
			"ReferenceDirSegments": headerPathSegments(r, "ref", "ref_browser", firstPath(referencePaths)),
			"TargetBrowseURL":      browserURL(r, "target_browser"),
			"ReferenceBrowseURL":   browserURL(r, "ref_browser"),
		},
	}

	if err := h.reg.RenderWithBase(w, "base", "assets/templates/index.html", ctx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

type LoadRequest struct {
	PageID    string   `json:"page_id"`
	Side      string   `json:"side"`
	Paths     []string `json:"paths"`
	Recursive bool     `json:"recursive"`
}

type LoadResponse struct {
	TaskID string `json:"task_id"`
}

type TimezoneLookupRequest struct {
	Entries []TimezoneLookupEntry `json:"entries"`
}

type TimezoneLookupEntry struct {
	ID        string `json:"id"`
	Timezone  string `json:"timezone"`
	LocalTime string `json:"local_time,omitempty"`
	Instant   string `json:"instant,omitempty"`
}

type TimezoneLookupResponse struct {
	Results []TimezoneLookupResult `json:"results"`
}

type TimezoneLookupResult struct {
	ID        string `json:"id"`
	Offset    string `json:"offset,omitempty"`
	LocalTime string `json:"local_time,omitempty"`
	Error     string `json:"error,omitempty"`
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

func (h *Handlers) Image(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	info, err := os.Stat(path)
	if err != nil {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}
	if ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	http.ServeFile(w, r, path)
}

func (h *Handlers) TimezoneOffsets(w http.ResponseWriter, r *http.Request) {
	var req TimezoneLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	resp := TimezoneLookupResponse{
		Results: make([]TimezoneLookupResult, 0, len(req.Entries)),
	}
	for _, entry := range req.Entries {
		result := TimezoneLookupResult{ID: entry.ID}
		loc, err := time.LoadLocation(strings.TrimSpace(entry.Timezone))
		if err != nil {
			result.Error = "invalid timezone"
			resp.Results = append(resp.Results, result)
			continue
		}

		switch {
		case entry.Instant != "":
			t, err := time.Parse(time.RFC3339Nano, entry.Instant)
			if err != nil {
				result.Error = "invalid instant"
				break
			}
			local := t.In(loc)
			result.Offset = formatOffsetSeconds(local)
			result.LocalTime = local.Format("2006-01-02 15:04:05")
		case entry.LocalTime != "":
			t, err := time.ParseInLocation("2006-01-02 15:04:05", entry.LocalTime, loc)
			if err != nil {
				result.Error = "invalid local_time"
				break
			}
			result.Offset = formatOffsetSeconds(t)
			result.LocalTime = t.Format("2006-01-02 15:04:05")
		default:
			result.Error = "missing time context"
		}
		resp.Results = append(resp.Results, result)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handlers) ProgressWS(w http.ResponseWriter, r *http.Request) {
	pageID := r.URL.Query().Get("page_id")
	if pageID == "" {
		http.Error(w, "missing page_id", http.StatusBadRequest)
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		slog.Error("websocket accept", "err", err)
		return
	}
	defer conn.CloseNow()

	client := &progress.Client{
		PageID: pageID,
		Send:   make(chan []byte, 64),
		Conn:   conn,
	}
	h.hub.Register(client)
	defer h.hub.Unregister(client)

	ctx := r.Context()
	go client.WritePump(ctx)

	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := conn.Ping(ctx); err != nil {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	conn.SetReadLimit(512)
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return
		}
	}
}

func (h *Handlers) Load(w http.ResponseWriter, r *http.Request) {
	var req LoadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.PageID == "" {
		http.Error(w, "missing page_id", http.StatusBadRequest)
		return
	}
	side := model.Side(req.Side)
	if side != model.SideTarget && side != model.SideReference {
		http.Error(w, "invalid side", http.StatusBadRequest)
		return
	}
	if len(req.Paths) == 0 {
		http.Error(w, "missing paths", http.StatusBadRequest)
		return
	}

	taskID := newID()
	go h.runLoadTask(context.Background(), req.PageID, taskID, req.Paths, side, req.Recursive)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(LoadResponse{TaskID: taskID})
}

func (h *Handlers) runLoadTask(ctx context.Context, pageID, taskID string, roots []string, side model.Side, recursive bool) {
	rootLabel := summarizeRoots(roots)
	tracker := progress.NewTracker(pageID, taskID, h.hub)
	tracker.SetOperation("file.scan", rootLabel, 0)

	var extractor *exif.Extractor
	if len(roots) > 0 {
		var err error
		extractor, err = exif.New()
		if err != nil {
			slog.Warn("failed to initialize exiftool for async load; continuing without exif data", "err", err)
			tracker.Error(progress.ItemError{Code: "exiftool.init", Error: err.Error()})
		} else {
			defer extractor.Close()
		}
	}

	_, err := scan.Photos(roots, side, recursive, h.cfg.RefreshMetadata, extractor, h.store, tracker)
	if err != nil {
		tracker.Fatal(err)
		return
	}
	_ = ctx
	tracker.Done()
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
	return scan.Photos(roots, side, recursive, refreshMetadata, extractor, st, nil)
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
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
		return pathLabel(roots[0])
	}
	return fmt.Sprintf("%d directories", len(roots))
}

func pathLabel(path string) string {
	if path == "" {
		return ""
	}
	cleaned := filepath.Clean(path)
	base := filepath.Base(cleaned)
	switch base {
	case ".", string(filepath.Separator), "":
		return cleaned
	default:
		return base
	}
}

func compactPathDisplay(path string) string {
	if path == "" {
		return ""
	}

	cleaned := filepath.Clean(path)
	sep := string(filepath.Separator)

	if cleaned == sep {
		return cleaned
	}

	absolute := filepath.IsAbs(cleaned)
	trimmed := strings.TrimPrefix(cleaned, sep)
	parts := strings.Split(trimmed, sep)
	if len(parts) == 1 && parts[0] == cleaned {
		parts = strings.Split(cleaned, sep)
		absolute = false
	}

	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" && part != "." {
			filtered = append(filtered, part)
		}
	}
	parts = filtered

	if len(parts) == 0 {
		return cleaned
	}

	if len(parts) <= 2 {
		display := strings.Join(parts, " "+sep+" ")
		if absolute {
			return sep + " " + display
		}
		return display
	}

	return "... " + sep + " " + strings.Join(parts[len(parts)-2:], " "+sep+" ")
}

func headerPathSegments(r *http.Request, queryName, browserFlag, path string) []HeaderPathSegment {
	if path == "" {
		return nil
	}

	cleaned := filepath.Clean(path)
	rawSegments := compactPathDisplay(cleaned)
	if rawSegments == "" {
		return nil
	}

	pathSegments := pathPrefixSegments(cleaned)
	if len(pathSegments) == 0 {
		return []HeaderPathSegment{{
			Label:     rawSegments,
			Path:      cleaned,
			URL:       browserPathURL(r, queryName, browserFlag, cleaned),
			Current:   true,
			Clickable: true,
		}}
	}

	start := 0
	if len(pathSegments) > 2 {
		start = len(pathSegments) - 2
	}

	segments := make([]HeaderPathSegment, 0, len(pathSegments)-start+1)
	if start > 0 {
		segments = append(segments, HeaderPathSegment{
			Label:     "...",
			Clickable: false,
		})
	}

	for idx := start; idx < len(pathSegments); idx++ {
		segment := pathSegments[idx]
		segments = append(segments, HeaderPathSegment{
			Label:     pathLabel(segment),
			Path:      segment,
			URL:       browserPathURL(r, queryName, browserFlag, segment),
			Current:   idx == len(pathSegments)-1,
			Clickable: true,
		})
	}

	return segments
}

func pathPrefixSegments(path string) []string {
	cleaned := filepath.Clean(path)
	sep := string(filepath.Separator)
	if cleaned == "" || cleaned == "." {
		return nil
	}
	if cleaned == sep {
		return []string{cleaned}
	}

	absolute := filepath.IsAbs(cleaned)
	trimmed := strings.TrimPrefix(cleaned, sep)
	parts := strings.Split(trimmed, sep)
	if len(parts) == 1 && parts[0] == cleaned {
		parts = strings.Split(cleaned, sep)
		absolute = false
	}

	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" && part != "." {
			filtered = append(filtered, part)
		}
	}
	parts = filtered
	if len(parts) == 0 {
		return []string{cleaned}
	}

	prefixes := make([]string, 0, len(parts))
	if absolute {
		current := sep
		for _, part := range parts {
			current = filepath.Join(current, part)
			prefixes = append(prefixes, current)
		}
		return prefixes
	}

	current := ""
	for _, part := range parts {
		if current == "" {
			current = part
		} else {
			current = filepath.Join(current, part)
		}
		prefixes = append(prefixes, current)
	}
	return prefixes
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

func browserURL(r *http.Request, name string) string {
	query := copyQuery(r.URL.Query())
	query.Set(name, "1")
	if encoded := query.Encode(); encoded != "" {
		return r.URL.Path + "?" + encoded
	}
	return r.URL.Path
}

func formatOffsetSeconds(t time.Time) string {
	_, seconds := t.Zone()
	sign := "+"
	if seconds < 0 {
		sign = "-"
		seconds = -seconds
	}
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	return fmt.Sprintf("%s%02d:%02d", sign, hours, minutes)
}

func browserPathURL(r *http.Request, queryName, browserFlag, path string) string {
	query := copyQuery(r.URL.Query())
	query.Set(browserFlag, "1")
	query.Del(queryName)
	query.Add(queryName, path)
	if encoded := query.Encode(); encoded != "" {
		return r.URL.Path + "?" + encoded
	}
	return r.URL.Path
}

func copyQuery(src url.Values) url.Values {
	dst := make(url.Values, len(src))
	for key, values := range src {
		dst[key] = append([]string(nil), values...)
	}
	return dst
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
