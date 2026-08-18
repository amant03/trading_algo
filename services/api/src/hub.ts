import WebSocket from 'ws';

type EventType =
  | 'snapshot' | 'candle' | 'signal' | 'news' | 'trade' | 'order' | 'equity' | 'ready';

export class WsHub {
  private clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    this.send(ws, 'ready', { clients: this.clients.size });
  }

  broadcast(type: EventType, payload: unknown): void {
    if (!this.clients.size) return;
    const frame = JSON.stringify({ type, payload, ts: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          this.clients.delete(ws);
        }
      }
    }
  }

  private send(ws: WebSocket, type: EventType, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export const hub = new WsHub();