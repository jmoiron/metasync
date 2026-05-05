package web

import (
	"net/http/httptest"
	"testing"
)

func TestParseByteSize(t *testing.T) {
	tests := []struct {
		in   string
		want int64
	}{
		{"10mb", 10 * 1024 * 1024},
		{"10m", 10 * 1024 * 1024},
		{"4MB", 4 * 1024 * 1024},
		{"512kb", 512 * 1024},
		{"512k", 512 * 1024},
		{"123", 123},
	}
	for _, tt := range tests {
		got, err := parseByteSize(tt.in)
		if err != nil {
			t.Fatalf("parseByteSize(%q) unexpected error: %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("parseByteSize(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestParsePreviewBounds(t *testing.T) {
	w, h, err := parsePreviewBounds("1600x1200")
	if err != nil {
		t.Fatalf("parsePreviewBounds unexpected error: %v", err)
	}
	if w != 1600 || h != 1200 {
		t.Fatalf("parsePreviewBounds = %dx%d, want 1600x1200", w, h)
	}
}

func TestImagePathFromRequest(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/photo/foo.jpg", nil)
	path, err := imagePathFromRequest(req)
	if err != nil {
		t.Fatalf("imagePathFromRequest unexpected error: %v", err)
	}
	if path != "/mnt/omocha/photo/foo.jpg" {
		t.Fatalf("imagePathFromRequest = %q, want %q", path, "/mnt/omocha/photo/foo.jpg")
	}
}

func TestImagePathFromRequestWithEncodedSpaces(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/jmoiron/img/photo/2024.12%20-%20Hong%20Kong/ref/IMG_1234.JPG", nil)
	path, err := imagePathFromRequest(req)
	if err != nil {
		t.Fatalf("imagePathFromRequest unexpected error: %v", err)
	}
	want := "/mnt/omocha/jmoiron/img/photo/2024.12 - Hong Kong/ref/IMG_1234.JPG"
	if path != want {
		t.Fatalf("imagePathFromRequest = %q, want %q", path, want)
	}
}

func TestImagePathFromRequestWithEncodedPunctuation(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/photo/100%25%20real/IMG%20%231.JPG", nil)
	path, err := imagePathFromRequest(req)
	if err != nil {
		t.Fatalf("imagePathFromRequest unexpected error: %v", err)
	}
	want := "/mnt/omocha/photo/100% real/IMG #1.JPG"
	if path != want {
		t.Fatalf("imagePathFromRequest = %q, want %q", path, want)
	}
}

func TestImagePathFromRequestQueryFallback(t *testing.T) {
	req := httptest.NewRequest("GET", "/image?path=/mnt/omocha/photo/foo.jpg", nil)
	path, err := imagePathFromRequest(req)
	if err != nil {
		t.Fatalf("imagePathFromRequest unexpected error: %v", err)
	}
	if path != "/mnt/omocha/photo/foo.jpg" {
		t.Fatalf("imagePathFromRequest = %q, want %q", path, "/mnt/omocha/photo/foo.jpg")
	}
}

func TestParsePreviewRequestDefaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/photo/foo.jpg", nil)
	maxBytes, maxWidth, maxHeight, err := (&Handlers{}).parsePreviewRequest(req)
	if err != nil {
		t.Fatalf("parsePreviewRequest unexpected error: %v", err)
	}
	if maxBytes != defaultPreviewMaxBytes {
		t.Fatalf("maxBytes = %d, want %d", maxBytes, defaultPreviewMaxBytes)
	}
	if maxWidth != defaultPreviewMaxWidth || maxHeight != defaultPreviewMaxHeight {
		t.Fatalf("bounds = %dx%d, want %dx%d", maxWidth, maxHeight, defaultPreviewMaxWidth, defaultPreviewMaxHeight)
	}
}

func TestParsePreviewRequestCustom(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/photo/foo.jpg?size=4mb&res=1600x1200", nil)
	maxBytes, maxWidth, maxHeight, err := (&Handlers{}).parsePreviewRequest(req)
	if err != nil {
		t.Fatalf("parsePreviewRequest unexpected error: %v", err)
	}
	if maxBytes != 4*1024*1024 {
		t.Fatalf("maxBytes = %d, want %d", maxBytes, 4*1024*1024)
	}
	if maxWidth != 1600 || maxHeight != 1200 {
		t.Fatalf("bounds = %dx%d, want 1600x1200", maxWidth, maxHeight)
	}
}

func TestParsePreviewRequestConfiguredDefault(t *testing.T) {
	req := httptest.NewRequest("GET", "/image/mnt/omocha/photo/foo.jpg", nil)
	h := &Handlers{cfg: PageConfig{PreviewMaxSize: 2 * 1024 * 1024}}
	maxBytes, maxWidth, maxHeight, err := h.parsePreviewRequest(req)
	if err != nil {
		t.Fatalf("parsePreviewRequest unexpected error: %v", err)
	}
	if maxBytes != 2*1024*1024 {
		t.Fatalf("maxBytes = %d, want %d", maxBytes, 2*1024*1024)
	}
	if maxWidth != defaultPreviewMaxWidth || maxHeight != defaultPreviewMaxHeight {
		t.Fatalf("bounds = %dx%d, want %dx%d", maxWidth, maxHeight, defaultPreviewMaxWidth, defaultPreviewMaxHeight)
	}
}
