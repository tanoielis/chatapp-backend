import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject<Env> {
  clients: WebSocket[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    this.handleWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  handleWebSocket(ws: WebSocket) {
    ws.accept();
    this.clients.push(ws);

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        console.warn("Invalid JSON from client");
        return;
      }

      if (typeof msg.username === "string" && typeof msg.message === "string") {
        const payload = JSON.stringify(msg);
        for (const client of this.clients) {
          try {
            client.send(payload);
          } catch {
            // Ignore failed sends
          }
        }
      }
    });

    ws.addEventListener("close", () => this.cleanup(ws));
    ws.addEventListener("error", () => this.cleanup(ws));
  }

  cleanup(ws: WebSocket) {
    this.clients = this.clients.filter(c => c !== ws);
  }
}
