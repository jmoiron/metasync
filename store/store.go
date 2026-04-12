package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jmoiron/monet/db/monarch"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"

	"github.com/jmoiron/metasync/model"
)

type Store struct {
	db       *sqlx.DB
	ShareDir string
	CacheDir string
}

const upsertImageSQL = `
	INSERT INTO images (
		hash,
		full_path,
		filename,
		modified_unix_ns,
		size,
		res_x,
		res_y,
		exif_time,
		exif_offset,
		gps_time,
		gps_lat,
		gps_lon,
		aperture,
		exposure,
		focal_length,
		iso,
		metering_mode,
		camera_model,
		cached_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(hash) DO UPDATE SET
		full_path = excluded.full_path,
		filename = excluded.filename,
		modified_unix_ns = excluded.modified_unix_ns,
		size = excluded.size,
		res_x = excluded.res_x,
		res_y = excluded.res_y,
		exif_time = excluded.exif_time,
		exif_offset = excluded.exif_offset,
		gps_time = excluded.gps_time,
		gps_lat = excluded.gps_lat,
		gps_lon = excluded.gps_lon,
		aperture = excluded.aperture,
		exposure = excluded.exposure,
		focal_length = excluded.focal_length,
		iso = excluded.iso,
		metering_mode = excluded.metering_mode,
		camera_model = excluded.camera_model,
		cached_at = excluded.cached_at
`

var imageMigrations = monarch.Set{
	Name: "metasync_images",
	Migrations: []monarch.Migration{
		{
			Up: `CREATE TABLE IF NOT EXISTS images (
				hash TEXT PRIMARY KEY,
				full_path TEXT NOT NULL,
				filename TEXT NOT NULL,
				modified_unix_ns INTEGER NOT NULL,
				size INTEGER NOT NULL,
				res_x INTEGER,
				res_y INTEGER,
				exif_time TEXT,
				gps_lat REAL,
				gps_lon REAL,
				aperture REAL,
				exposure TEXT,
				focal_length REAL,
				iso INTEGER,
				metering_mode TEXT,
				camera_model TEXT,
				cached_at TEXT NOT NULL
			);`,
			Down: `DROP TABLE images;`,
		},
		{
			Up:   `CREATE INDEX IF NOT EXISTS image_full_path ON images (full_path);`,
			Down: `DROP INDEX image_full_path;`,
		},
		{
			Up:   `ALTER TABLE images ADD COLUMN exif_offset TEXT;`,
			Down: ``,
		},
		{
			Up:   `ALTER TABLE images ADD COLUMN gps_time TEXT;`,
			Down: ``,
		},
	},
}

func New() (*Store, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	shareDir := filepath.Join(home, ".local", "share", "metasync")
	cacheDir := filepath.Join(home, ".cache", "metasync")
	if err := os.MkdirAll(shareDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, err
	}

	db, err := sqlx.Connect("sqlite3", filepath.Join(shareDir, "metadata.db"))
	if err != nil {
		return nil, err
	}

	s := &Store{
		db:       db,
		ShareDir: shareDir,
		CacheDir: cacheDir,
	}
	if err := s.init(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Hash(path string, modTime time.Time) string {
	sum := sha256.Sum256([]byte(path + "\x00" + fmt.Sprintf("%d", modTime.UTC().UnixNano())))
	return hex.EncodeToString(sum[:])
}

func (s *Store) Lookup(hash string) (model.Photo, bool, error) {
	if s == nil || s.db == nil {
		return model.Photo{}, false, nil
	}

	row := s.db.QueryRow(`
		SELECT
			hash,
			full_path,
			filename,
			modified_unix_ns,
			size,
			res_x,
			res_y,
			exif_time,
			exif_offset,
			gps_time,
			gps_lat,
			gps_lon,
			aperture,
			exposure,
			focal_length,
			iso,
			metering_mode,
			camera_model
		FROM images
		WHERE hash = ?
	`, hash)

	var (
		p            model.Photo
		modUnixNS    int64
		exifTime     sql.NullString
		exifOffset   sql.NullString
		gpsTime      sql.NullString
		gpsLat       sql.NullFloat64
		gpsLon       sql.NullFloat64
		aperture     sql.NullFloat64
		exposure     sql.NullString
		focalLength  sql.NullFloat64
		iso          sql.NullInt64
		meteringMode sql.NullString
		cameraModel  sql.NullString
	)
	err := row.Scan(
		&p.CacheKey,
		&p.Path,
		&p.BaseName,
		&modUnixNS,
		&p.Size,
		&p.Exif.Width,
		&p.Exif.Height,
		&exifTime,
		&exifOffset,
		&gpsTime,
		&gpsLat,
		&gpsLon,
		&aperture,
		&exposure,
		&focalLength,
		&iso,
		&meteringMode,
		&cameraModel,
	)
	if err == sql.ErrNoRows {
		return model.Photo{}, false, nil
	}
	if err != nil {
		return model.Photo{}, false, err
	}

	p.ModTime = time.Unix(0, modUnixNS)
	if exifTime.Valid {
		if t, err := time.Parse(time.RFC3339Nano, exifTime.String); err == nil {
			p.Exif.DateTimeOriginal = &t
		}
	}
	if exifOffset.Valid {
		p.Exif.OffsetTimeOriginal = exifOffset.String
	}
	if gpsTime.Valid {
		if t, err := time.Parse(time.RFC3339Nano, gpsTime.String); err == nil {
			p.Exif.GPSDateTime = &t
		}
	}
	if gpsLat.Valid {
		v := gpsLat.Float64
		p.Exif.GPSLatitude = &v
	}
	if gpsLon.Valid {
		v := gpsLon.Float64
		p.Exif.GPSLongitude = &v
	}
	if aperture.Valid {
		v := aperture.Float64
		p.Exif.Aperture = &v
	}
	if exposure.Valid {
		p.Exif.Exposure = exposure.String
	}
	if focalLength.Valid {
		v := focalLength.Float64
		p.Exif.FocalLength = &v
	}
	if iso.Valid {
		v := int(iso.Int64)
		p.Exif.ISO = &v
	}
	if meteringMode.Valid {
		p.Exif.MeteringMode = meteringMode.String
	}
	if cameraModel.Valid {
		p.Exif.CameraModel = cameraModel.String
	}
	return p, true, nil
}

func (s *Store) Upsert(p model.Photo) error {
	return s.UpsertMany([]model.Photo{p})
}

func (s *Store) UpsertMany(photos []model.Photo) error {
	if s == nil || s.db == nil {
		return nil
	}
	if len(photos) == 0 {
		return nil
	}

	tx, err := s.db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Preparex(upsertImageSQL)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range photos {
		if _, err := stmt.Exec(upsertArgs(p)...); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) init() error {
	manager, err := monarch.NewManager(s.db)
	if err != nil {
		return err
	}
	return manager.Upgrade(imageMigrations)
}

func nullIfZero(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

func nullFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullString(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func upsertArgs(p model.Photo) []any {
	var exifTime any
	if t := p.Exif.Time(); t != nil {
		exifTime = t.Format(time.RFC3339Nano)
	}
	var gpsTime any
	if p.Exif.GPSDateTime != nil {
		gpsTime = p.Exif.GPSDateTime.UTC().Format(time.RFC3339Nano)
	}

	return []any{
		p.CacheKey,
		p.Path,
		p.BaseName,
		p.ModTime.UTC().UnixNano(),
		p.Size,
		nullIfZero(p.Exif.Width),
		nullIfZero(p.Exif.Height),
		exifTime,
		nullString(p.Exif.OffsetTimeOriginal),
		gpsTime,
		nullFloat(p.Exif.GPSLatitude),
		nullFloat(p.Exif.GPSLongitude),
		nullFloat(p.Exif.Aperture),
		nullString(p.Exif.Exposure),
		nullFloat(p.Exif.FocalLength),
		nullInt(p.Exif.ISO),
		nullString(p.Exif.MeteringMode),
		nullString(p.Exif.CameraModel),
		time.Now().UTC().Format(time.RFC3339Nano),
	}
}
