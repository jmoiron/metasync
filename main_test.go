package main

import "testing"

func TestParseSizeSpec(t *testing.T) {
	tests := []struct {
		in   string
		want int64
	}{
		{"1m", 1024 * 1024},
		{"10mb", 10 * 1024 * 1024},
		{"512k", 512 * 1024},
		{"2g", 2 * 1024 * 1024 * 1024},
		{"123", 123},
	}

	for _, tt := range tests {
		got, err := parseSizeSpec(tt.in)
		if err != nil {
			t.Fatalf("parseSizeSpec(%q) unexpected error: %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("parseSizeSpec(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}
