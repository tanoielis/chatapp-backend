import { DurableObject } from "cloudflare:workers";

type WSObject = {
	type: "init" | "message";
	payload: Message[];
}

type Message = {
	username: string,
	message: string,
	timestamp: number
}

export class ChatRoom extends DurableObject<Env> {
	clients: WebSocket[] = [];
	messages: Message[] = [];
	MAX_HISTORY = 10;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			this.messages = (await this.ctx.storage.get("messages")) || [];
		})
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 400 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.ctx.acceptWebSocket(server);
		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const wsObject = JSON.parse(message as string);
		switch (wsObject.type) {
			case "init":
				await this.sendMessages(ws);
				break;
			case "message":
				await this.sendMessage(wsObject);
				break;
			default:
				break;
		}
	}

	async sendMessages(ws: WebSocket) {
		ws.send(JSON.stringify({
			type: "init",
			payload: this.messages
		}));
	}

	async sendMessage(wsObject: WSObject) {
		// Save message in local history
		this.messages.push(wsObject.payload[0]);

		// Broadcast message to all clients
		for (const client of this.ctx.getWebSockets()) {
			try {
				client.send(JSON.stringify(wsObject));
			} catch { }
		}
		
		// Keep the history at most 10
		if (this.messages.length > this.MAX_HISTORY) {
			this.messages.shift();
		}

		// Persist message in storage
		await this.ctx.storage.put("messages", this.messages);
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		ws.close(code, "Closing websocket connection.");
	}
}