package comp

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	exiftool "github.com/barasher/go-exiftool"
	"github.com/jmoiron/etruscan"
	wasmexif "github.com/yashikota/exiftool-go/pkg/exiftool"
)

// TestFullMetadataCoverageComparison compares every enumerated metadata field
// exposed by each reader. It reports differences instead of failing because
// the libraries can format the same stored value differently.
func TestFullMetadataCoverageComparison(t *testing.T) {
	fixtures := loadCorpus(t)
	if _, err := exec.LookPath("exiftool"); err != nil {
		t.Skip("exiftool is required for the go-exiftool implementation")
	}
	exiftoolReader, err := exiftool.NewExiftool(
		exiftool.PrintGroupNames("1"),
		exiftool.Buffer(make([]byte, 256*1024), 16*1024*1024),
	)
	if err != nil {
		t.Fatalf("initialize go-exiftool reader: %v", err)
	}
	defer exiftoolReader.Close()
	wasmReader, err := wasmexif.New()
	if err != nil {
		t.Fatalf("initialize exiftool-go WASM reader: %v", err)
	}
	defer wasmReader.Close()
	etruscanOptions := &etruscan.Options{Duplicates: true}

	for _, item := range fixtures {
		t.Run(item.name, func(t *testing.T) {
			toolTags, err := readExternalExifTool(exiftoolReader, item.path)
			if err != nil {
				t.Fatalf("read all tags with go-exiftool: %v", err)
			}
			wasmTags, err := readWASMExifTool(wasmReader, item.path)
			if err != nil {
				t.Fatalf("read all tags with exiftool-go WASM: %v", err)
			}
			etruscanTags, err := readEtruscan(item.path, etruscanOptions)
			if err != nil {
				t.Fatalf("read all tags with etruscan: %v", err)
			}

			image, err := openExiv(item.path)
			if err != nil {
				t.Fatalf("read all tags with goexiv: %v", err)
			}
			exivTags := make(map[string]string)
			for key, value := range image.GetExifData().ExiftoolTags(true) {
				exivTags[canonicalExivKey(key)] = value
			}
			for key, value := range image.GetIptcData().AllTags() {
				exivTags[canonicalExivKey(key)] = value
			}
			for key, value := range image.GetXmpData().AllTags() {
				exivTags[canonicalExivKey(key)] = value
			}
			readers := map[string]map[string]string{
				"go-exiftool":      flattenTagNames(toolTags),
				"goexiv":           flattenTagNames(exivTags),
				"exiftool-go-wasm": flattenTagNames(wasmTags),
				"etruscan":         flattenTagNames(etruscanTags),
			}
			readerNames := []string{"go-exiftool", "goexiv", "exiftool-go-wasm", "etruscan"}
			if !readerMapsMatch(readers, readerNames) {
				t.Logf("metadata fields: go-exiftool=%d goexiv=%d exiftool-go-wasm=%d etruscan=%d",
					len(readers["go-exiftool"]), len(readers["goexiv"]), len(readers["exiftool-go-wasm"]), len(readers["etruscan"]))
				t.Logf("differences by tag name:\n%s", formatReaderDifferenceTable(readers))
			}
			runtime.KeepAlive(image)
		})
	}
}

// TestExifToolEtruscanComparison directly compares the external ExifTool
// wrapper with etruscan using matching group and print-conversion behavior.
func TestExifToolEtruscanComparison(t *testing.T) {
	fixtures := loadCorpus(t)
	if _, err := exec.LookPath("exiftool"); err != nil {
		t.Skip("exiftool is required for the go-exiftool implementation")
	}
	reader, err := exiftool.NewExiftool(
		exiftool.PrintGroupNames("1"),
		exiftool.Buffer(make([]byte, 256*1024), 16*1024*1024),
	)
	if err != nil {
		t.Fatalf("initialize go-exiftool reader: %v", err)
	}
	defer reader.Close()

	// ExifTool's default print conversion is on; unknown tags and embedded
	// extraction remain off, matching its normal -j output.
	options := &etruscan.Options{Duplicates: true}
	for _, item := range fixtures {
		t.Run(item.name, func(t *testing.T) {
			toolTags, err := readExternalExifTool(reader, item.path)
			if err != nil {
				t.Fatalf("read all tags with go-exiftool: %v", err)
			}
			etruscanValues, err := readEtruscanValues(item.path, options)
			if err != nil {
				t.Fatalf("read all tags with etruscan: %v", err)
			}
			etruscanTags := reconcileValues(toolTags, etruscanValues)
			readers := map[string]map[string]string{
				"go-exiftool": flattenTagNames(toolTags),
				"etruscan":    flattenTagNames(etruscanTags),
			}
			readerNames := []string{"go-exiftool", "etruscan"}
			if !readerMapsMatch(readers, readerNames) {
				t.Logf("metadata fields: go-exiftool=%d etruscan=%d",
					len(readers["go-exiftool"]), len(readers["etruscan"]))
				t.Logf("differences by tag name:\n%s", formatReaderDifferenceTableFor(readers, readerNames))
			}
		})
	}
}

func readEtruscan(path string, opts *etruscan.Options) (map[string]string, error) {
	values, err := readEtruscanValues(path, opts)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(values))
	for key, all := range values {
		result[key] = strings.Join(all, " | ")
	}
	return result, nil
}

// readEtruscanValues returns every value of each group:name key, in file order.
func readEtruscanValues(path string, opts *etruscan.Options) (map[string][]string, error) {
	metadata, err := etruscan.Read(path, opts)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]string, len(metadata.Tags))
	for _, tag := range metadata.Tags {
		group := tag.Group1
		if group == "" {
			group = tag.Group0
		}
		key, keep := canonicalExifToolKey(group + ":" + tag.Name)
		if !keep {
			continue
		}
		result[key] = append(result[key], tag.Print)
	}
	return result, nil
}

// reconcileValues flattens etruscan's values to one string per key for the
// comparison table. The external exiftool is run without -a, so it reports a
// single instance of a tag that appears several times in one group (and picks
// it by priority, not position). When it is among etruscan's values for the
// key, up to normalization, that value stands in for all of them; otherwise
// every etruscan value is shown.
func reconcileValues(tool map[string]string, values map[string][]string) map[string]string {
	result := make(map[string]string, len(values))
	for key, all := range values {
		result[key] = strings.Join(all, " | ")
		want, ok := tool[key]
		if !ok {
			continue
		}
		for _, got := range all {
			if equivalentValues(want, got) {
				result[key] = want
				break
			}
		}
	}
	return result
}

// equivalentValues reports whether two printed values differ only by
// presentation: surrounding whitespace, numeric formatting (go-exiftool reads
// exiftool's -j output, which turns numeric-looking strings into JSON numbers:
// 11.0 -> 11, 12.50 -> 12.5), or a list of strings that -j emits as a JSON
// array where etruscan gives exiftool's ", "-joined text.
func equivalentValues(a, b string) bool {
	a, b = normalizeValue(a), normalizeValue(b)
	if a == b {
		return true
	}
	x, errA := strconv.ParseFloat(a, 64)
	y, errB := strconv.ParseFloat(b, 64)
	return errA == nil && errB == nil && x == y
}

func normalizeValue(v string) string {
	v = strings.TrimSpace(v)
	if strings.HasPrefix(v, "[") {
		var items []string
		if json.Unmarshal([]byte(v), &items) == nil {
			return strings.Join(items, ", ")
		}
	}
	return v
}

func readExternalExifTool(reader *exiftool.Exiftool, path string) (map[string]string, error) {
	results := reader.ExtractMetadata(path)
	if len(results) != 1 {
		return nil, fmt.Errorf("got %d result records", len(results))
	}
	if results[0].Err != nil {
		return nil, results[0].Err
	}
	return formatReaderFields(results[0].Fields, true)
}

func readWASMExifTool(reader *wasmexif.ExifTool, path string) (map[string]string, error) {
	fields, err := reader.ReadMetadata(path)
	if err != nil {
		return nil, err
	}
	return formatReaderFields(fields, false)
}

func formatReaderFields(fields map[string]any, grouped bool) (map[string]string, error) {
	result := make(map[string]string, len(fields))
	for key, value := range fields {
		if grouped {
			canonical, ok := canonicalExifToolKey(key)
			if !ok {
				continue
			}
			key = canonical
		} else if group, tag, ok := strings.Cut(key, ":"); ok {
			if canonical, keep := canonicalExifToolKey(group + ":" + tag); keep {
				key = canonical
			}
		}
		if text, ok := value.(string); ok {
			result[key] = text
			continue
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("encode %s: %w", key, err)
		}
		result[key] = string(encoded)
	}
	return result, nil
}

func canonicalExifToolKey(key string) (string, bool) {
	group, tag, ok := strings.Cut(key, ":")
	if !ok || tag == "" {
		return "", false
	}
	switch group {
	case "ExifTool", "System", "File", "Composite":
		return "", false
	}
	return canonicalGroup(group) + ":" + tag, true
}

func canonicalExivKey(key string) string {
	parts := strings.Split(key, ".")
	if len(parts) >= 3 && parts[0] == "Xmp" {
		return "XMP-" + parts[1] + ":" + parts[len(parts)-1]
	}
	if len(parts) < 3 {
		return key
	}
	group := strings.Join(parts[:len(parts)-1], ".")
	tag := parts[len(parts)-1]
	switch group {
	case "Exif.Image":
		group = "IFD0"
	case "Exif.Photo":
		group = "ExifIFD"
	case "Exif.GPSInfo":
		group = "GPS"
	case "Exif.Iop":
		group = "InteropIFD"
	case "Iptc.Application2":
		group = "IPTC"
	default:
		group = strings.TrimPrefix(group, "Exif.")
	}
	return group + ":" + tag
}

func canonicalGroup(group string) string {
	switch group {
	case "IFD1":
		return "IFD1"
	case "ExifIFD":
		return "ExifIFD"
	case "GPS":
		return "GPS"
	case "InteropIFD":
		return "InteropIFD"
	case "IPTC":
		return "IPTC"
	default:
		return group
	}
}

func flattenTagNames(tags map[string]string) map[string]string {
	type entry struct{ group, value string }
	values := make(map[string][]entry, len(tags))
	for key, value := range tags {
		group, name, ok := strings.Cut(key, ":")
		if !ok {
			name = key
			group = ""
		}
		values[name] = append(values[name], entry{group: group, value: value})
	}
	result := make(map[string]string, len(values))
	for name, entries := range values {
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].group == entries[j].group {
				return entries[i].value < entries[j].value
			}
			return entries[i].group < entries[j].group
		})
		formatted := make([]string, len(entries))
		for i, entry := range entries {
			formatted[i] = entry.value
			if len(entries) > 1 && entry.group != "" {
				formatted[i] = entry.group + "=" + entry.value
			}
		}
		result[name] = strings.Join(formatted, " | ")
	}
	return result
}

func formatReaderDifferenceTable(readers map[string]map[string]string) string {
	return formatReaderDifferenceTableFor(readers, []string{"go-exiftool", "goexiv", "exiftool-go-wasm", "etruscan"})
}

func readerMapsMatch(readers map[string]map[string]string, names []string) bool {
	if len(names) < 2 {
		return true
	}
	first := readers[names[0]]
	for _, name := range names[1:] {
		other := readers[name]
		if len(first) != len(other) {
			return false
		}
		for key, value := range first {
			if otherValue, ok := other[key]; !ok || otherValue != value {
				return false
			}
		}
	}
	return true
}

func formatReaderDifferenceTableFor(readers map[string]map[string]string, readerNames []string) string {
	keys := make(map[string]struct{})
	for _, tags := range readers {
		for key := range tags {
			keys[key] = struct{}{}
		}
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)

	header := append([]string{"Tag"}, readerNames...)
	separator := make([]string, len(header))
	for i := range separator {
		separator[i] = "---"
	}
	rows := []string{"| " + strings.Join(header, " | ") + " |", "| " + strings.Join(separator, " | ") + " |"}
	differences := 0
	for _, key := range ordered {
		values := make([]string, len(readerNames))
		present := make([]bool, len(readerNames))
		for i, name := range readerNames {
			values[i], present[i] = readers[name][key]
		}
		presentCount := 0
		for _, exists := range present {
			if exists {
				presentCount++
			}
		}
		allEqual := presentCount == len(values)
		for i := 1; i < len(values) && allEqual; i++ {
			allEqual = values[0] == values[i]
		}
		if allEqual {
			continue
		}
		differences++
		for i, value := range values {
			if !present[i] {
				values[i] = "-"
			} else {
				values[i] = strings.ReplaceAll(shortenValue(value), "|", "\\|")
			}
		}
		row := []string{"`" + key + "`"}
		for _, value := range values {
			row = append(row, "`"+value+"`")
		}
		rows = append(rows, "| "+strings.Join(row, " | ")+" |")
	}
	if differences == 0 {
		row := []string{"(none)", "All readers returned matching names and values"}
		for len(row) < len(header) {
			row = append(row, "")
		}
		rows = append(rows, "| "+strings.Join(row, " | ")+" |")
	}
	return strings.Join(rows, "\n")
}

func shortenValue(value string) string {
	const maxLen = 160
	if len(value) <= maxLen {
		return value
	}
	return value[:maxLen-3] + "..."
}
