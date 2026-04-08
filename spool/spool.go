// package spool implements a synchronized pool
package spool

import "sync"

// A Pool runs multiple goroutine functions in parallel, with routines
// for collecting their errors and waiting for the jobs to finish.
type Pool struct {
	wg       sync.WaitGroup
	dg       sync.WaitGroup
	nthreads int
	errch    chan error
	errs     []error
	once     sync.Once
}

// NewPool creates a new pool with nthreads level of parallelism.
func NewPool(nthreads int) *Pool {
	return &Pool{
		nthreads: nthreads,
		errch:    make(chan error, nthreads),
	}
}

func (p *Pool) drain() {
	p.dg.Add(1)
	for err := range p.errch {
		p.errs = append(p.errs, err)
	}
	p.dg.Done()
}

// Do executes nthreads copies of fn.
func (p *Pool) Do(fn func()) {
	p.once.Do(func() {
		go p.drain()
	})
	p.wg.Add(p.nthreads)
	for i := 0; i < p.nthreads; i++ {
		go func() {
			fn()
			p.wg.Done()
		}()
	}
}

// Err adds an error to the pool. Runner gets these errors when calling Wait().
func (p *Pool) Err(err error) {
	if err != nil {
		p.errch <- err
	}
}

// Wait for this pool to finish. Returns any errors added to the pool.
func (p *Pool) Wait() []error {
	p.wg.Wait()
	close(p.errch)
	p.dg.Wait()
	return p.errs
}
