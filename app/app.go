package app

import (
	"embed"
	"io/fs"
	"log/slog"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jmoiron/monet/mtr"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/progress"
	"github.com/jmoiron/metasync/scan"
	"github.com/jmoiron/metasync/store"
	"github.com/jmoiron/metasync/web"
	"github.com/jmoiron/metasync/xplat"
)

//go:embed assets/templates/*.html
var templates embed.FS

//go:embed assets/static/*.css assets/static/js/*.js assets/static/fonts/* assets/static/vendor assets/static/fa/*
var static embed.FS

type Config struct {
	ListenAddr      string
	Debug           bool
	TargetPaths     []string
	ReferencePaths  []string
	Recursive       bool
	RefreshMetadata bool
	Workers         int
	BatchSize       int
}

type App struct {
	cfg    Config
	router http.Handler
	store  *store.Store
}

func New(cfg Config) (*App, error) {
	st, err := store.New()
	if err != nil {
		return nil, err
	}

	reg := mtr.NewRegistry()
	reg.DefaultCtx["title"] = "metasync"
	reg.DefaultCtx["debug"] = cfg.Debug

	reg.AddBaseFS("base", "assets/templates/base.html", templates)
	reg.AddPathFS("assets/templates/index.html", templates)
	reg.AddPathFS("assets/templates/pane.html", templates)
	if err := reg.Build(); err != nil {
		st.Close()
		return nil, err
	}

	staticFS, err := fs.Sub(static, "assets/static")
	if err != nil {
		st.Close()
		return nil, err
	}

	pageCfg := web.PageConfig{
		Debug:             cfg.Debug,
		TargetPaths:       cfg.TargetPaths,
		ReferencePaths:    cfg.ReferencePaths,
		DefaultBrowsePath: xplat.DefaultBrowsePath(),
		Recursive:         cfg.Recursive,
		RefreshMetadata:   cfg.RefreshMetadata,
		Workers:           cfg.Workers,
		BatchSize:         cfg.BatchSize,
	}

	exif.Configure(cfg.Workers, cfg.BatchSize)
	scan.Configure(cfg.Workers)

	initial := preload(st, pageCfg)
	hub := progress.NewHub()
	go hub.Run()

	h := web.NewHandlers(reg, st, pageCfg, initial, hub)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", h.Index)
	r.Get("/pane", h.Pane)
	r.Post("/apply", h.Apply)
	r.Post("/load", h.Load)
	r.Post("/timezone-offsets", h.TimezoneOffsets)
	r.Get("/browse", h.BrowseDirectories)
	r.Get("/image", h.Image)
	r.Get("/exif", h.InspectExif)
	r.Get("/ws", h.ProgressWS)
	r.Get("/healthz", h.Healthz)
	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))
	r.Handle("/cache/*", http.StripPrefix("/cache/", http.FileServer(http.Dir(st.CacheDir))))

	return &App{
		cfg:    cfg,
		router: r,
		store:  st,
	}, nil
}

func (a *App) Run() error {
	listener, err := net.Listen("tcp", a.cfg.ListenAddr)
	if err != nil {
		return err
	}
	return a.Serve(listener)
}

func (a *App) Serve(listener net.Listener) error {
	return http.Serve(listener, a.router)
}

func preload(st *store.Store, cfg web.PageConfig) web.InitialState {
	if len(cfg.TargetPaths) == 0 && len(cfg.ReferencePaths) == 0 {
		return web.InitialState{}
	}

	slog.Info("preloading startup scan", "targets", cfg.TargetPaths, "refs", cfg.ReferencePaths, "recursive", cfg.Recursive, "refresh_metadata", cfg.RefreshMetadata)
	var extractor *exif.Extractor
	if len(cfg.TargetPaths) > 0 || len(cfg.ReferencePaths) > 0 {
		var err error
		extractor, err = exif.New()
		if err != nil {
			slog.Warn("failed to initialize exiftool during startup preload; continuing without exif data", "err", err)
		} else {
			defer extractor.Close()
		}
	}

	targetPhotos, targetErr := preloadSide(cfg.TargetPaths, model.SideTarget, cfg.Recursive, cfg.RefreshMetadata, extractor, st)
	referencePhotos, referenceErr := preloadSide(cfg.ReferencePaths, model.SideReference, cfg.Recursive, cfg.RefreshMetadata, extractor, st)
	slog.Info("startup preload complete", "target_count", len(targetPhotos), "ref_count", len(referencePhotos))

	return web.InitialState{
		TargetPhotos:    targetPhotos,
		ReferencePhotos: referencePhotos,
		TargetError:     targetErr,
		ReferenceError:  referenceErr,
	}
}

func preloadSide(roots []string, side model.Side, recursive bool, refreshMetadata bool, extractor *exif.Extractor, st *store.Store) ([]model.Photo, error) {
	if len(roots) == 0 {
		return nil, nil
	}
	return scan.Photos(roots, side, recursive, refreshMetadata, extractor, st, nil)
}
