# EXIF implementation comparison corpus

This package compares the application's `go-exiftool` wrapper, local `goexiv`
bindings to exiv2, `exiftool-go`'s WebAssembly reader, and the local `etruscan`
wrapper around exiftool-rs. An optional local corpus can be placed in
`testdata/corpus/`; tests discover supported images there and only write to
temporary copies under `t.TempDir()`. The corpus directory is git-ignored, so
the large source images are not part of the repository. Without a corpus, the
comparison tests and corpus benchmark skip; the rest of the Go test suite still
runs normally.

The original corpus covers:

- EXIF time and timezone offsets, including older files without an offset
- GPS coordinates and GPS timestamps
- Rotated-image orientation metadata
- Canon maker notes and metadata from multiple camera generations
- Metadata from phone cameras, including panorama images
- Invalid all-zero timestamps
- JPEG, PNG, TIFF, CR2, CR3, and HIF containers, including formats with known
  Exiv2 BMFF write limitations

`TestFullMetadataCoverageComparison` compares all four readers. It uses
goexiv's ExifTool-compatible maker-note mode and includes EXIF, IPTC, and XMP
tags. The report matches by tag name (retaining grouped distinctions when
multiple readers return the same name) and may show derived and file
properties as reader-only. The report is informational, not a pass/fail
equality assertion, because the readers format some typed values differently.
Run it with
`go test ./exif/comp -run '^TestFullMetadataCoverageComparison$' -v` to see the
per-image report.

`TestExifToolEtruscanComparison` prints the same per-image difference table for
only go-exiftool and etruscan. It compares ExifTool group family 1 and uses
etruscan's default print conversion with duplicate tags enabled, while leaving
unknown-tag and embedded extraction options disabled to match the normal
ExifTool JSON read.

Run with `go test ./exif/comp`. The test package requires `exiftool`, libexiv2
0.28.x, a C++17 compiler, and the etruscan Rust static library. Build the
latter with `make -C exif/etruscan rust` (Rust >= 1.82 and a C toolchain).
Writes are tested across JPEG, PNG, TIFF, and
CR2. ExifTool writes to CR3/HIF are cross-read by exiv2; the local exiv2
binding reports that writes to BMFF files (CR3/HIF) are unsupported, and the
test records that limitation explicitly.

## Benchmarks

Benchmarks use Go's standard `testing.B` output and compare one-image reads by
the external go-exiftool wrapper, local goexiv/exiv2 binding,
and etruscan/exiftool-rs. The `exiftool-go` WebAssembly reader remains in the
metadata comparison test, but is excluded from benchmarks: in the corpus
benchmark it was approximately 20x slower than go-exiftool. This is an observed
result for this corpus and environment, not a general performance guarantee.
The built-in corpus benchmark needs no environment variables. To benchmark a
separate, read-only image tree, set
`METASYNC_EXIF_BENCH_DIR` to its root:

```sh
METASYNC_EXIF_BENCH_DIR=/mnt/omocha/img/photo \
  go test ./exif/comp -run '^$' -bench 'BenchmarkRead(Corpus|Directory)' -benchmem -v
```

All readers use four workers by default, matching the application's go-exiftool
configuration. Set `METASYNC_EXIF_BENCH_WORKERS` to a positive integer to use a
different worker count for all readers.

The directory benchmark walks supported image extensions and reads every
discovered file in each benchmark operation; it never invokes either library's
write API. If the variable is unset, that benchmark is skipped with the command
needed to enable it. Keep `-v` in the command to display that skip message.
