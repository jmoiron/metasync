package app

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jmoiron/monet/mtr"

	"github.com/jmoiron/metasync/exif"
	"github.com/jmoiron/metasync/model"
	"github.com/jmoiron/metasync/scan"
	"github.com/jmoiron/metasync/store"
	"github.com/jmoiron/metasync/web"
)

//go:embed assets/templates/*.html
var templates embed.FS

//go:embed assets/static/*.css assets/static/js/*.js assets/static/fonts/* assets/static/vendor assets/static/fa/*
var static embed.FS

type Config struct {
	ListenAddr      string
	Debug           bool
	TargetPath      string
	ReferencePath   string
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
		Debug:           cfg.Debug,
		TargetPath:      cfg.TargetPath,
		ReferencePath:   cfg.ReferencePath,
		Recursive:       cfg.Recursive,
		RefreshMetadata: cfg.RefreshMetadata,
		Workers:         cfg.Workers,
		BatchSize:       cfg.BatchSize,
	}

	exif.Configure(cfg.Workers, cfg.BatchSize)
	scan.Configure(cfg.Workers)

	initial := preload(st, pageCfg)

	h := web.NewHandlers(reg, st, pageCfg, initial)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", h.Index)
	r.Post("/apply", h.Apply)
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
	return http.ListenAndServe(a.cfg.ListenAddr, a.router)
}

func preload(st *store.Store, cfg web.PageConfig) web.InitialState {
	if cfg.TargetPath == "" && cfg.ReferencePath == "" {
		return web.InitialState{}
	}

	slog.Info("preloading startup scan", "target", cfg.TargetPath, "ref", cfg.ReferencePath, "recursive", cfg.Recursive, "refresh_metadata", cfg.RefreshMetadata)
	var extractor *exif.Extractor
	if cfg.TargetPath != "" || cfg.ReferencePath != "" {
		var err error
		extractor, err = exif.New()
		if err != nil {
			slog.Warn("failed to initialize exiftool during startup preload; continuing without exif data", "err", err)
		} else {
			defer extractor.Close()
		}
	}

	targetPhotos, targetErr := preloadSide(cfg.TargetPath, model.SideTarget, cfg.Recursive, cfg.RefreshMetadata, extractor, st)
	referencePhotos, referenceErr := preloadSide(cfg.ReferencePath, model.SideReference, cfg.Recursive, cfg.RefreshMetadata, extractor, st)
	slog.Info("startup preload complete", "target_count", len(targetPhotos), "ref_count", len(referencePhotos))

	return web.InitialState{
		TargetPhotos:    targetPhotos,
		ReferencePhotos: referencePhotos,
		TargetError:     targetErr,
		ReferenceError:  referenceErr,
	}
}

func preloadSide(root string, side model.Side, recursive bool, refreshMetadata bool, extractor *exif.Extractor, st *store.Store) ([]model.Photo, error) {
	if root == "" {
		return nil, nil
	}
	return scan.Photos(root, side, recursive, refreshMetadata, extractor, st)
}
