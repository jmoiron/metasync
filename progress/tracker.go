package progress

import (
	"math"
	"sync"
	"time"
)

const defaultEmitInterval = 125 * time.Millisecond

type Publisher interface {
	Publish(pageID string, snap Snapshot)
}

type Tracker struct {
	mu           sync.Mutex
	pageID       string
	pub          Publisher
	snap         Snapshot
	lastEmit     time.Time
	emitInterval time.Duration
}

func NewTracker(pageID, taskID string, pub Publisher) *Tracker {
	now := time.Now()
	return &Tracker{
		pageID: pageID,
		pub:    pub,
		snap: Snapshot{
			TaskID:    taskID,
			StartedAt: now,
			UpdatedAt: now,
		},
		emitInterval: defaultEmitInterval,
	}
}

func (t *Tracker) SetOperation(op string, location string, total int) {
	t.mu.Lock()
	t.snap.Operation = op
	t.snap.Location = location
	t.snap.Total = total
	if t.snap.Progress > total && total > 0 {
		t.snap.Progress = total
	}
	t.updateDerivedLocked()
	snap := t.snapshotLocked()
	t.lastEmit = time.Now()
	t.mu.Unlock()
	t.publish(snap)
}

func (t *Tracker) Add(delta int) {
	t.mu.Lock()
	t.snap.Progress += delta
	if t.snap.Progress < 0 {
		t.snap.Progress = 0
	}
	if t.snap.Total > 0 && t.snap.Progress > t.snap.Total {
		t.snap.Progress = t.snap.Total
	}
	t.updateDerivedLocked()
	snap, shouldEmit := t.snapshotMaybeLocked(false)
	t.mu.Unlock()
	if shouldEmit {
		t.publish(snap)
	}
}

func (t *Tracker) Set(progress int) {
	t.mu.Lock()
	t.snap.Progress = progress
	if t.snap.Progress < 0 {
		t.snap.Progress = 0
	}
	if t.snap.Total > 0 && t.snap.Progress > t.snap.Total {
		t.snap.Progress = t.snap.Total
	}
	t.updateDerivedLocked()
	snap, shouldEmit := t.snapshotMaybeLocked(false)
	t.mu.Unlock()
	if shouldEmit {
		t.publish(snap)
	}
}

func (t *Tracker) Error(err ItemError) {
	t.mu.Lock()
	t.snap.Errors = append(t.snap.Errors, err)
	t.updateDerivedLocked()
	snap := t.snapshotLocked()
	t.lastEmit = time.Now()
	t.mu.Unlock()
	t.publish(snap)
}

func (t *Tracker) Fatal(err error) {
	t.mu.Lock()
	t.snap.Fatal = err.Error()
	t.snap.Done = false
	t.updateDerivedLocked()
	snap := t.snapshotLocked()
	t.lastEmit = time.Now()
	t.mu.Unlock()
	t.publish(snap)
}

func (t *Tracker) Done() {
	t.mu.Lock()
	if t.snap.Total > 0 {
		t.snap.Progress = t.snap.Total
	}
	t.snap.ProgressPct = 100
	t.snap.ETASeconds = 0
	t.snap.Done = true
	t.updateDerivedLocked()
	snap := t.snapshotLocked()
	t.lastEmit = time.Now()
	t.mu.Unlock()
	t.publish(snap)
}

func (t *Tracker) updateDerivedLocked() {
	now := time.Now()
	t.snap.UpdatedAt = now
	if t.snap.Total > 0 {
		t.snap.ProgressPct = (float64(t.snap.Progress) / float64(t.snap.Total)) * 100
	} else {
		t.snap.ProgressPct = 0
	}

	elapsed := now.Sub(t.snap.StartedAt).Seconds()
	if elapsed > 0 {
		t.snap.Rate = float64(t.snap.Progress) / elapsed
	} else {
		t.snap.Rate = 0
	}

	if t.snap.Total > 0 && t.snap.Rate > 0 && t.snap.Progress < t.snap.Total {
		t.snap.ETASeconds = float64(t.snap.Total-t.snap.Progress) / t.snap.Rate
	} else {
		t.snap.ETASeconds = 0
	}

	t.snap.ProgressPct = round2(t.snap.ProgressPct)
	t.snap.Rate = round2(t.snap.Rate)
	t.snap.ETASeconds = round2(t.snap.ETASeconds)
}

func (t *Tracker) snapshotMaybeLocked(force bool) (Snapshot, bool) {
	now := time.Now()
	if force || t.lastEmit.IsZero() || now.Sub(t.lastEmit) >= t.emitInterval {
		t.lastEmit = now
		return t.snapshotLocked(), true
	}
	return Snapshot{}, false
}

func (t *Tracker) snapshotLocked() Snapshot {
	snap := t.snap
	if len(t.snap.Errors) > 0 {
		snap.Errors = append([]ItemError(nil), t.snap.Errors...)
	}
	return snap
}

func (t *Tracker) publish(snap Snapshot) {
	if t.pub == nil {
		return
	}
	t.pub.Publish(t.pageID, snap)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
