package model

import (
	"fmt"
	"strconv"
	"time"
)

type Side string

const (
	SideTarget    Side = "target"
	SideReference Side = "reference"
)

type ExifData struct {
	DateTimeOriginal   *time.Time
	OffsetTimeOriginal string
	CreateDate         *time.Time
	ModifyDate         *time.Time
	GPSDateTime        *time.Time
	GPSTimeZone        string
	GPSLatitude        *float64
	GPSLongitude       *float64
	Width              int
	Height             int
	Aperture           *float64
	Exposure           string
	FocalLength        *float64
	ISO                *int
	MeteringMode       string
	CameraModel        string
}

func (e ExifData) Time() *time.Time {
	switch {
	case e.DateTimeOriginal != nil:
		return e.DateTimeOriginal
	case e.CreateDate != nil:
		return e.CreateDate
	case e.ModifyDate != nil:
		return e.ModifyDate
	default:
		return nil
	}
}

func (e ExifData) TimeDisplay() string {
	if t := e.Time(); t != nil {
		return t.Format("2006-01-02 15:04:05")
	}
	return "n/a"
}

func (e ExifData) TimeOffsetDisplay() string {
	return e.OffsetTimeOriginal
}

func (e ExifData) TimeDisplayWithOffset() string {
	if t := e.Time(); t != nil {
		if e.OffsetTimeOriginal != "" {
			return t.Format("2006-01-02 15:04:05") + " " + e.OffsetTimeOriginal
		}
		return t.Format("2006-01-02 15:04:05")
	}
	return "n/a"
}

func (e ExifData) GPSTimeDisplay() string {
	if e.GPSDateTime != nil {
		return e.GPSDateTime.UTC().Format("2006-01-02 15:04:05Z")
	}
	return "n/a"
}

func (e ExifData) GPSTimeAttr() string {
	if e.GPSDateTime != nil {
		return e.GPSDateTime.UTC().Format(time.RFC3339Nano)
	}
	return ""
}

func (e ExifData) GPSTimeZoneDisplay() string {
	return e.GPSTimeZone
}

func (e ExifData) GPSDisplay() string {
	if e.GPSLatitude == nil || e.GPSLongitude == nil {
		return "n/a"
	}
	return fmt.Sprintf("%.6f, %.6f", *e.GPSLatitude, *e.GPSLongitude)
}

func (e ExifData) GPSLatitudeAttr() string {
	if e.GPSLatitude == nil {
		return ""
	}
	return fmt.Sprintf("%.6f", *e.GPSLatitude)
}

func (e ExifData) GPSLongitudeAttr() string {
	if e.GPSLongitude == nil {
		return ""
	}
	return fmt.Sprintf("%.6f", *e.GPSLongitude)
}

func (e ExifData) Resolution() string {
	if e.Width <= 0 || e.Height <= 0 {
		return "n/a"
	}
	return fmt.Sprintf("%dx%d", e.Width, e.Height)
}

func (e ExifData) ApertureDisplay() string {
	if e.Aperture == nil {
		return "n/a"
	}
	return fmt.Sprintf("f/%.1f", *e.Aperture)
}

func (e ExifData) ExposureDisplay() string {
	if e.Exposure == "" {
		return "n/a"
	}
	if v, err := strconv.ParseFloat(e.Exposure, 64); err == nil && v > 0 {
		if v >= 1 {
			return fmt.Sprintf("%.1fs", v)
		}
		denom := int((1 / v) + 0.5)
		if denom > 0 {
			return fmt.Sprintf("1/%d", denom)
		}
	}
	return e.Exposure
}

func (e ExifData) FocalLengthDisplay() string {
	if e.FocalLength == nil {
		return "n/a"
	}
	return fmt.Sprintf("%.0fmm", *e.FocalLength)
}

func (e ExifData) ISODisplay() string {
	if e.ISO == nil {
		return "n/a"
	}
	return fmt.Sprintf("%d", *e.ISO)
}

func (e ExifData) MeteringModeDisplay() string {
	if e.MeteringMode == "" {
		return "n/a"
	}
	return e.MeteringMode
}

func (e ExifData) CameraModelDisplay() string {
	if e.CameraModel == "" {
		return "n/a"
	}
	return e.CameraModel
}

type Photo struct {
	ID           string
	CacheKey     string
	Side         Side
	Path         string
	RelativePath string
	BaseName     string
	Extension    string
	Size         int64
	ModTime      time.Time
	Exif         ExifData
}

func (p Photo) Resolution() string {
	return p.Exif.Resolution()
}

func (p Photo) ExifTimeDisplay() string {
	return p.Exif.TimeDisplay()
}

func (p Photo) ExifGPSDisplay() string {
	return p.Exif.GPSDisplay()
}

func (p Photo) ThumbnailURL() string {
	if p.CacheKey == "" {
		return ""
	}
	return "/cache/" + p.CacheKey + ".jpg"
}
