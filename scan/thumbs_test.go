package scan

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func BenchmarkThumbnailGoLarge(b *testing.B) { benchmarkThumbnailGo(b, "large.jpg") }
func BenchmarkThumbnailGoMed(b *testing.B)   { benchmarkThumbnailGo(b, "med.jpg") }
func BenchmarkThumbnailGoSmall(b *testing.B) { benchmarkThumbnailGo(b, "small.jpg") }
func BenchmarkThumbnailConvertLarge(b *testing.B) {
	benchmarkThumbnailConvert(b, "large.jpg")
}
func BenchmarkThumbnailConvertMed(b *testing.B) {
	benchmarkThumbnailConvert(b, "med.jpg")
}
func BenchmarkThumbnailConvertSmall(b *testing.B) {
	benchmarkThumbnailConvert(b, "small.jpg")
}

func benchmarkThumbnailGo(b *testing.B, name string) {
	srcPath := filepath.Join("..", "data", name)
	dstPath := filepath.Join("/dev/shm", fmt.Sprintf("metasync-bench-go-%s.jpg", name))

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := os.Remove(dstPath); err != nil && !os.IsNotExist(err) {
			b.Fatal(err)
		}
		if err := ThumbnailGo(srcPath, dstPath); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkThumbnailConvert(b *testing.B, name string) {
	if _, err := exec.LookPath("convert"); err != nil {
		b.Skip("convert not installed")
	}

	srcPath := filepath.Join("..", "data", name)
	dstPath := filepath.Join("/dev/shm", fmt.Sprintf("metasync-bench-convert-%s.jpg", name))

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := os.Remove(dstPath); err != nil && !os.IsNotExist(err) {
			b.Fatal(err)
		}
		if err := ThumbnailConvert(srcPath, dstPath); err != nil {
			b.Fatal(err)
		}
	}
}
