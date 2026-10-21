package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/metasync/model"
)

func (s *Store) GPSLogEntries() ([]model.GPSLogEntry, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}

	rows, err := s.db.Queryx(`
		SELECT source_path, local_datetime, utc_offset, utc_datetime, latitude, longitude
		FROM gps_log_entries
		ORDER BY utc_datetime, source_path
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]model.GPSLogEntry, 0)
	for rows.Next() {
		var entry model.GPSLogEntry
		var offset sql.NullString
		var utc string
		if err := rows.Scan(&entry.SourcePath, &entry.LocalDateTime, &offset, &utc, &entry.Latitude, &entry.Longitude); err != nil {
			return nil, err
		}
		if offset.Valid {
			entry.Offset = offset.String
		}
		entry.UTCDateTime, err = time.Parse(time.RFC3339Nano, utc)
		if err != nil {
			return nil, fmt.Errorf("parse stored gps log time: %w", err)
		}
		if entry.UTCDateTime.Year() < model.GPSLogMinimumYear {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) DeleteGPSLogEntry(sourcePath string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	result, err := s.db.Exec(`DELETE FROM gps_log_entries WHERE source_path = ?`, sourcePath)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) GPSLogEntryCount() (int, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	var count int
	err := s.db.Get(&count, `SELECT COUNT(*) FROM gps_log_entries`)
	return count, err
}

func (s *Store) UpsertGPSLogEntries(entries []model.GPSLogEntry) error {
	if s == nil || s.db == nil || len(entries) == 0 {
		return nil
	}

	tx, err := s.db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Preparex(`
		INSERT INTO gps_log_entries (
			source_path, local_datetime, utc_offset, utc_datetime, latitude, longitude, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_path) DO UPDATE SET
			local_datetime = excluded.local_datetime,
			utc_offset = excluded.utc_offset,
			utc_datetime = excluded.utc_datetime,
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			updated_at = excluded.updated_at
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, entry := range entries {
		if _, err := stmt.Exec(
			entry.SourcePath,
			entry.LocalDateTime,
			nullString(entry.Offset),
			entry.UTCDateTime.UTC().Format(time.RFC3339Nano),
			entry.Latitude,
			entry.Longitude,
			now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
