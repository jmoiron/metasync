package main

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/pflag"

	"github.com/jmoiron/metasync/app"
	"github.com/jmoiron/metasync/xplat"
)

type options struct {
	Listen         string
	OpenBrowser    bool
	Debug          bool
	TargetPaths    []string
	ReferencePaths []string
	Recursive      bool
	RefreshMeta    bool
	Workers        int
	BatchSize      int
	PreviewMaxSize int64
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
		TargetPaths:     opts.TargetPaths,
		ReferencePaths:  opts.ReferencePaths,
		Recursive:       opts.Recursive,
		RefreshMetadata: opts.RefreshMeta,
		Workers:         opts.Workers,
		BatchSize:       opts.BatchSize,
		PreviewMaxSize:  opts.PreviewMaxSize,
	})
	if err != nil {
		slog.Error("initializing app", "err", err)
		os.Exit(1)
	}

	slog.Info(
		"starting metasync",
		"listen", opts.Listen,
		"open_browser", opts.OpenBrowser,
		"debug", opts.Debug,
		"targets", opts.TargetPaths,
		"refs", opts.ReferencePaths,
		"recursive", opts.Recursive,
		"refresh_metadata", opts.RefreshMeta,
		"workers", opts.Workers,
		"batch_size", opts.BatchSize,
		"preview_max_size", opts.PreviewMaxSize,
	)

	if !opts.OpenBrowser {
		if err := srv.Run(); err != nil {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
		return
	}

	listener, err := net.Listen("tcp", opts.Listen)
	if err != nil {
		slog.Error("starting listener", "err", err)
		os.Exit(1)
	}

	url := browserURL(listener.Addr())
	if err := xplat.OpenBrowser(url); err != nil {
		slog.Warn("failed to open browser", "url", url, "err", err)
	} else {
		slog.Info("opened browser", "url", url)
	}

	if err := srv.Serve(listener); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func parseFlags() options {
	var opts options
	pflag.StringVar(&opts.Listen, "listen", "127.0.0.1:8080", "listen address")
	pflag.BoolVar(&opts.OpenBrowser, "open-browser", false, "open the metasync URL in the default browser after the server starts")
	pflag.BoolVar(&opts.Debug, "debug", false, "enable debug logging")
	pflag.StringArrayVar(&opts.TargetPaths, "target", nil, "path to a target photo directory; may be provided multiple times")
	pflag.StringArrayVar(&opts.ReferencePaths, "ref", nil, "path to a reference photo directory; may be provided multiple times")
	pflag.BoolVarP(&opts.Recursive, "recursive", "r", false, "recurse through target and reference directories")
	pflag.BoolVar(&opts.RefreshMeta, "refresh-metadata", false, "re-extract photo metadata instead of reading cached metadata")
	pflag.IntVar(&opts.Workers, "workers", 4, "number of workers for metadata extraction and thumbnail generation")
	pflag.IntVar(&opts.BatchSize, "batch-size", 4, "number of files per EXIF extraction batch")
	var previewMaxSize string
	pflag.StringVar(&previewMaxSize, "preview-max-size", "10m", "max original image size before serving a resized preview, for example 1m or 10m")
	pflag.Parse()
	var err error
	opts.PreviewMaxSize, err = parseSizeSpec(previewMaxSize)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid --preview-max-size: %v\n", err)
		os.Exit(2)
	}
	return opts
}

func parseSizeSpec(value string) (int64, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return 0, fmt.Errorf("empty size")
	}

	multiplier := int64(1)
	switch {
	case strings.HasSuffix(value, "kb"):
		multiplier = 1024
		value = strings.TrimSuffix(value, "kb")
	case strings.HasSuffix(value, "mb"):
		multiplier = 1024 * 1024
		value = strings.TrimSuffix(value, "mb")
	case strings.HasSuffix(value, "gb"):
		multiplier = 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "gb")
	case strings.HasSuffix(value, "k"):
		multiplier = 1024
		value = strings.TrimSuffix(value, "k")
	case strings.HasSuffix(value, "m"):
		multiplier = 1024 * 1024
		value = strings.TrimSuffix(value, "m")
	case strings.HasSuffix(value, "g"):
		multiplier = 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "g")
	case strings.HasSuffix(value, "b"):
		value = strings.TrimSuffix(value, "b")
	}

	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || number <= 0 {
		return 0, fmt.Errorf("invalid size %q", value)
	}
	return int64(number * float64(multiplier)), nil
}

func browserURL(addr net.Addr) string {
	host, port, err := net.SplitHostPort(addr.String())
	if err != nil {
		return "http://localhost/"
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, port) + "/"
}
