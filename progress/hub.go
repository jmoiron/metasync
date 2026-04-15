package progress

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/coder/websocket"
)

type Client struct {
	PageID string
	Send   chan []byte
	Conn   *websocket.Conn
}

func (c *Client) WritePump(ctx context.Context) {
	for {
		select {
		case msg, ok := <-c.Send:
			if !ok {
				return
			}
			if err := c.Conn.Write(ctx, websocket.MessageText, msg); err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

type Hub struct {
	register   chan *Client
	unregister chan *Client
	publish    chan Event
	clients    map[string]map[*Client]struct{}
}

func NewHub() *Hub {
	return &Hub{
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		publish:    make(chan Event, 256),
		clients:    make(map[string]map[*Client]struct{}),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			if h.clients[c.PageID] == nil {
				h.clients[c.PageID] = make(map[*Client]struct{})
			}
			h.clients[c.PageID][c] = struct{}{}
		case c := <-h.unregister:
			if bucket := h.clients[c.PageID]; bucket != nil {
				delete(bucket, c)
				if len(bucket) == 0 {
					delete(h.clients, c.PageID)
				}
			}
			close(c.Send)
		case evt := <-h.publish:
			data, err := json.Marshal(evt)
			if err != nil {
				slog.Error("marshal progress event", "err", err)
				continue
			}
			h.fanOut(h.clients[evt.PageID], data)
		}
	}
}

func (h *Hub) fanOut(bucket map[*Client]struct{}, data []byte) {
	for c := range bucket {
		select {
		case c.Send <- data:
		default:
			slog.Warn("dropping progress event for slow websocket client", "page_id", c.PageID)
		}
	}
}

func (h *Hub) Register(c *Client)   { h.register <- c }
func (h *Hub) Unregister(c *Client) { h.unregister <- c }

func (h *Hub) Publish(pageID string, snap Snapshot) {
	select {
	case h.publish <- Event{
		Type:     "progress",
		PageID:   pageID,
		Progress: snap,
	}:
	default:
		slog.Warn("progress publish channel full, dropping event", "page_id", pageID, "task_id", snap.TaskID)
	}
}
