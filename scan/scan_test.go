package scan

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/jmoiron/metasync/model"
)

const tinyPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="

func TestPhotosFromRelativeRootReturnsAbsolutePaths(t *testing.T) {
	tmpDir := t.TempDir()
	rootDir := filepath.Join(tmpDir, "photos")
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	data, err := base64.StdEncoding.DecodeString(tinyPNGBase64)
	if err != nil {
		t.Fatalf("DecodeString: %v", err)
	}
	imgPath := filepath.Join(rootDir, "example.png")
	if err := os.WriteFile(imgPath, data, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(oldWD)
	}()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("Chdir: %v", err)
	}

	photos, err := Photos([]string{"photos"}, model.SideTarget, false, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("Photos: %v", err)
	}
	if len(photos) != 1 {
		t.Fatalf("len(photos) = %d, want 1", len(photos))
	}
	if !filepath.IsAbs(photos[0].Path) {
		t.Fatalf("Photo.Path = %q, want absolute path", photos[0].Path)
	}
	if photos[0].Path != imgPath {
		t.Fatalf("Photo.Path = %q, want %q", photos[0].Path, imgPath)
	}
	if photos[0].RelativePath != "example.png" {
		t.Fatalf("Photo.RelativePath = %q, want %q", photos[0].RelativePath, "example.png")
	}
}
