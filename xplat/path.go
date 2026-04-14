package xplat

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type PathSegment struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type DirectoryEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}

type DirectoryBrowseResult struct {
	Path      string
	Separator string
	Segments  []PathSegment
	Entries   []DirectoryEntry
}

type BrowseOptions struct {
	ShowFiles       bool
	ShowHiddenPaths bool
}

func DefaultBrowsePath() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Clean(home)
	}
	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		return filepath.Clean(cwd)
	}
	return string(os.PathSeparator)
}

func BrowseDirectories(path string, opts BrowseOptions) (DirectoryBrowseResult, error) {
	res := DirectoryBrowseResult{
		Separator: string(os.PathSeparator),
	}

	normalized, err := normalizeBrowsePath(path)
	if err != nil {
		return res, err
	}

	res.Path = normalized
	res.Segments = SplitPath(normalized)

	info, err := os.Stat(normalized)
	if err != nil {
		return res, err
	}
	if !info.IsDir() {
		return res, fmt.Errorf("%s is not a directory", normalized)
	}

	entries, err := os.ReadDir(normalized)
	if err != nil {
		return res, err
	}

	visible := make([]DirectoryEntry, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !opts.ShowHiddenPaths && isHiddenPath(name) {
			continue
		}
		fullPath := filepath.Join(normalized, name)
		isDir, err := browseEntryIsDir(entry, fullPath)
		if err != nil {
			continue
		}
		if !isDir && !opts.ShowFiles {
			continue
		}
		visible = append(visible, DirectoryEntry{
			Name:  name,
			Path:  fullPath,
			IsDir: isDir,
		})
	}

	sort.Slice(visible, func(i, j int) bool {
		if visible[i].IsDir != visible[j].IsDir {
			return visible[i].IsDir
		}
		left := strings.ToLower(visible[i].Name)
		right := strings.ToLower(visible[j].Name)
		if left == right {
			return visible[i].Name < visible[j].Name
		}
		return left < right
	})

	res.Entries = visible
	return res, nil
}

func SplitPath(path string) []PathSegment {
	clean := filepath.Clean(path)
	sep := string(os.PathSeparator)
	volume := filepath.VolumeName(clean)
	remainder := clean[len(volume):]

	segments := make([]PathSegment, 0, 8)
	current := volume

	if strings.HasPrefix(remainder, sep) {
		rootPath := volume + sep
		rootName := sep
		if volume != "" {
			rootName = volume
		}
		segments = append(segments, PathSegment{
			Name: rootName,
			Path: rootPath,
		})
		current = rootPath
		remainder = strings.TrimPrefix(remainder, sep)
	}

	for _, part := range strings.Split(remainder, sep) {
		if part == "" || part == "." {
			continue
		}
		if current == "" {
			current = part
		} else {
			current = filepath.Join(current, part)
		}
		segments = append(segments, PathSegment{
			Name: part,
			Path: current,
		})
	}

	if len(segments) == 0 && clean != "." && clean != "" {
		segments = append(segments, PathSegment{
			Name: clean,
			Path: clean,
		})
	}

	return segments
}

func normalizeBrowsePath(path string) (string, error) {
	if path == "" {
		path = DefaultBrowsePath()
	}
	return filepath.Abs(filepath.Clean(path))
}

func isHiddenPath(name string) bool {
	return strings.HasPrefix(name, ".")
}

func browseEntryIsDir(entry os.DirEntry, fullPath string) (bool, error) {
	if entry.IsDir() {
		return true, nil
	}
	if entry.Type()&os.ModeSymlink == 0 {
		return false, nil
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}
