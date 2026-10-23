package comp

import (
	"os"
	"testing"

	"github.com/kolesa-team/goexiv"
)

func TestMain(m *testing.M) {
	// Exiv2 emits warnings directly to stderr for some valid-but-unusual files
	// in the comparison corpus. Keep test and benchmark output focused; errors
	// are still returned by the binding and checked by the tests.
	goexiv.SetLogMsgLevel(goexiv.LogMsgMute)
	os.Exit(m.Run())
}
