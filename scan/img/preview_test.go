package img

import (
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsurePreviewResizesJPEGWithoutConvert(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source.jpg")
	cacheDir := filepath.Join(root, "cache")

	source := image.NewRGBA(image.Rect(0, 0, 2400, 1200))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), A: 255})
		}
	}
	file, err := os.Create(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, source, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	previewPath, err := EnsurePreview(sourcePath, cacheDir, "test-cache-key", 1_000_000, 1600, 1200)
	if err != nil {
		t.Fatalf("EnsurePreview returned error: %v", err)
	}

	preview, err := os.Open(previewPath)
	if err != nil {
		t.Fatal(err)
	}
	defer preview.Close()

	config, _, err := image.DecodeConfig(preview)
	if err != nil {
		t.Fatalf("DecodeConfig returned error: %v", err)
	}
	if config.Width != 1600 || config.Height != 800 {
		t.Fatalf("preview dimensions = %dx%d, want 1600x800", config.Width, config.Height)
	}
}
