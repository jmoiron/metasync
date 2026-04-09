package main

import (
	"log/slog"
	"os"

	"github.com/spf13/pflag"

	"github.com/jmoiron/metasync/app"
)

type options struct {
	Listen        string
	Debug         bool
	TargetPath    string
	ReferencePath string
	Recursive     bool
	RefreshMeta   bool
	Workers       int
	BatchSize     int
}

func main() {
	opts := parseFlags()

	level := new(slog.LevelVar)
	if opts.Debug {
		level.Set(slog.LevelDebug)
	}

	slog.SetDefault(slog.New(
		slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}),
	))

	srv, err := app.New(app.Config{
		ListenAddr:      opts.Listen,
		Debug:           opts.Debug,
		TargetPath:      opts.TargetPath,
		ReferencePath:   opts.ReferencePath,
		Recursive:       opts.Recursive,
		RefreshMetadata: opts.RefreshMeta,
		Workers:         opts.Workers,
		BatchSize:       opts.BatchSize,
	})
	if err != nil {
		slog.Error("initializing app", "err", err)
		os.Exit(1)
	}

	slog.Info(
		"starting metasync",
		"listen", opts.Listen,
		"debug", opts.Debug,
		"target", opts.TargetPath,
		"ref", opts.ReferencePath,
		"recursive", opts.Recursive,
		"refresh_metadata", opts.RefreshMeta,
		"workers", opts.Workers,
		"batch_size", opts.BatchSize,
	)
	if err := srv.Run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func parseFlags() options {
	var opts options
	pflag.StringVar(&opts.Listen, "listen", ":8080", "listen address")
	pflag.BoolVar(&opts.Debug, "debug", false, "enable debug logging")
	pflag.StringVar(&opts.TargetPath, "target", "", "path to the target photo directory")
	pflag.StringVar(&opts.ReferencePath, "ref", "", "path to the reference photo directory")
	pflag.BoolVarP(&opts.Recursive, "recursive", "r", false, "recurse through target and reference directories")
	pflag.BoolVar(&opts.RefreshMeta, "refresh-metadata", false, "re-extract photo metadata instead of reading cached metadata")
	pflag.IntVar(&opts.Workers, "workers", 4, "number of workers for metadata extraction and thumbnail generation")
	pflag.IntVar(&opts.BatchSize, "batch-size", 4, "number of files per EXIF extraction batch")
	pflag.Parse()
	return opts
}
