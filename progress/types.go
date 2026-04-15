package progress

import "time"

type ItemError struct {
	Path  string `json:"path,omitempty"`
	Code  string `json:"code,omitempty"`
	Error string `json:"error"`
}

type Snapshot struct {
	TaskID      string      `json:"task_id"`
	Operation   string      `json:"operation"`
	Location    string      `json:"location,omitempty"`
	Total       int         `json:"total"`
	Progress    int         `json:"progress"`
	ProgressPct float64     `json:"progress_pct"`
	Rate        float64     `json:"rate"`
	ETASeconds  float64     `json:"eta_seconds,omitempty"`
	Done        bool        `json:"done,omitempty"`
	Fatal       string      `json:"fatal,omitempty"`
	Errors      []ItemError `json:"errors,omitempty"`
	StartedAt   time.Time   `json:"started_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

type Event struct {
	Type     string   `json:"type"`
	PageID   string   `json:"page_id"`
	Progress Snapshot `json:"progress"`
}

type Reporter interface {
	SetOperation(op string, location string, total int)
	Add(delta int)
	Set(progress int)
	Error(err ItemError)
	Fatal(err error)
	Done()
}
