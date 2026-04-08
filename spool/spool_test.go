package spool

import "testing"

func TestPoolProcessesChannelJobs(t *testing.T) {
	const (
		nthreads = 4
		njobs    = 200
	)

	pool := NewPool(nthreads)
	jobs := make(chan int)
	processed := make(chan int, njobs)

	pool.Do(func() {
		for job := range jobs {
			processed <- job
		}
	})

	for i := 0; i < njobs; i++ {
		jobs <- i
	}
	close(jobs)

	errs := pool.Wait()
	if len(errs) != 0 {
		t.Fatalf("expected no errors, got %d", len(errs))
	}

	close(processed)
	seen := make(map[int]int, njobs)
	for job := range processed {
		seen[job]++
	}

	if len(seen) != njobs {
		t.Fatalf("expected %d processed jobs, got %d", njobs, len(seen))
	}

	for i := 0; i < njobs; i++ {
		if seen[i] != 1 {
			t.Fatalf("expected job %d exactly once, got %d", i, seen[i])
		}
	}
}

func TestPoolCollectsErrors(t *testing.T) {
	const nthreads = 3

	pool := NewPool(nthreads)
	pool.Do(func() {
		pool.Err(assertErr("worker failed"))
	})

	errs := pool.Wait()
	if len(errs) != nthreads {
		t.Fatalf("expected %d errors, got %d", nthreads, len(errs))
	}
}

type assertErr string

func (e assertErr) Error() string {
	return string(e)
}
