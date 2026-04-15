module github.com/jmoiron/metasync

go 1.26.1

require (
	github.com/Lionparcel/timezonemapper v1.0.1
	github.com/barasher/go-exiftool v1.10.0
	github.com/coder/websocket v1.8.14
	github.com/go-chi/chi/v5 v5.2.2
	github.com/jmoiron/monet v0.0.0
	github.com/jmoiron/sqlx v1.2.0
	github.com/mattn/go-sqlite3 v1.14.20
	github.com/spf13/pflag v1.0.5
	golang.org/x/image v0.30.0
)

require (
	dario.cat/mergo v1.0.0 // indirect
	github.com/go-sprout/sprout v0.6.0 // indirect
	github.com/spf13/cast v1.6.0 // indirect
	github.com/yuin/goldmark v1.7.8 // indirect
	golang.org/x/text v0.31.0 // indirect
)

replace github.com/jmoiron/monet => ../monet
