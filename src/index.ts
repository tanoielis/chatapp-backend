import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject<Env> {
	clients: WebSocket[] = [];
	messages: string[] = [];
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
		this.handleWebSocket(server);
		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}

	handleWebSocket(ws: WebSocket) {
		ws.accept();
		this.clients.push(ws);

		// Send last 10 messages
		for (const msg of this.messages) {
			try {
				ws.send(msg);
			} catch { }
		}

		ws.addEventListener("message", async (event) => {
			let msg;
			try {
				msg = JSON.parse(event.data as string);
			} catch {
				console.warn("Invalid JSON from client");
				return;
			}

			if (typeof msg.username === "string" && typeof msg.message === "string") {
				const payload = JSON.stringify(msg);

				// Save message history
				this.messages.push(payload);
				if (this.messages.length > this.MAX_HISTORY) {
					this.messages.shift();
				}

				// Persist message history
				await this.ctx.storage.put("messages", this.messages);

				// Broadcast user's message to all clients
				for (const client of this.clients) {
					try {
						client.send(payload);
					} catch { }
				}

				// Check if message is an AI prompt
				if (msg.message.startsWith("/ai ")) {
					const prompt = msg.message.slice(4).trim();

					// Build messages array for AI
					const aiMessages = [
						// System prompt
						{ role: "system", content: "You are a helpful assistant. You are currently in a chat room." },
						// User prompt
						{ role: "user", content: prompt }
					];

					// Call AI
					try {
						const aiResponse = await this.env.AI.run(
							"@cf/meta/llama-3.1-8b-instruct-fast",
							{ messages: aiMessages }
						);

						const aiReply = aiResponse.response?.trim();
						if (aiReply) {
							const aiMsg = JSON.stringify({
								username: "AI",
								message: aiReply
							});

							// Save AI message history
							this.messages.push(aiMsg);
							if (this.messages.length > this.MAX_HISTORY) {
								this.messages.shift();
							}

							// Persist AI message history
							await this.ctx.storage.put("messages", this.messages);

							// Broadcast AI's message
							for (const client of this.clients) {
								try {
									client.send(aiMsg);
								} catch { }
							}
						}
					} catch (err) {
						console.warn("AI request failed:", err);
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


/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const roomName = url.pathname.split("/").pop() || "default";
		const id: DurableObjectId = env.CHAT_ROOM.idFromName(roomName);
		const stub = env.CHAT_ROOM.get(id);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
