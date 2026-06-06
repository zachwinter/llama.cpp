// database.service.ts — HTTP client backed by threads.d (port 8083 on studio)
//
// Drop-in replacement for the Dexie/IndexedDB version.
// All method signatures and return types are identical — no store changes needed.
//
// Identity is resolved server-side from the request's source IP (Tailscale).
// Phase 2: swap THREADS_BASE_URL for a per-session token via /auth/challenge+verify.

const THREADS_BASE_URL = 'http://100.121.18.46:8083'

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${THREADS_BASE_URL}${path}`, {
		...opts,
		headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
	})
	if (!res.ok) throw new Error(`threads.d ${opts?.method ?? 'GET'} ${path} → ${res.status}`)
	return res.json() as Promise<T>
}

export class DatabaseService {
	// ── Conversations ──────────────────────────────────────────────────────────

	static async createConversation(name: string): Promise<DatabaseConversation> {
		return api('/conversations', {
			method: 'POST',
			body: JSON.stringify({ name }),
		})
	}

	static async getAllConversations(): Promise<DatabaseConversation[]> {
		return api('/conversations')
	}

	static async getConversation(id: string): Promise<DatabaseConversation | undefined> {
		const res = await api<DatabaseConversation | null>(`/conversations/${id}`)
		return res ?? undefined
	}

	static async updateConversation(
		id: string,
		updates: Partial<Omit<DatabaseConversation, 'id'>>
	): Promise<void> {
		await api(`/conversations/${id}`, {
			method: 'PUT',
			body: JSON.stringify(updates),
		})
	}

	static async updateCurrentNode(convId: string, nodeId: string): Promise<void> {
		await this.updateConversation(convId, { currNode: nodeId })
	}

	static async deleteConversation(
		id: string,
		options?: { deleteWithForks?: boolean }
	): Promise<void> {
		const qs = options?.deleteWithForks ? '?forks=1' : ''
		await api(`/conversations/${id}${qs}`, { method: 'DELETE' })
	}

	// ── Messages ───────────────────────────────────────────────────────────────

	static async getConversationMessages(convId: string): Promise<DatabaseMessage[]> {
		return api(`/conversations/${convId}/messages`)
	}

	static async createRootMessage(convId: string): Promise<string> {
		return api(`/conversations/${convId}/messages/root`, { method: 'POST', body: '{}' })
	}

	static async createMessageBranch(
		message: Omit<DatabaseMessage, 'id'>,
		parentId: string | null
	): Promise<DatabaseMessage> {
		return api(`/conversations/${message.convId}/messages/branch`, {
			method: 'POST',
			body: JSON.stringify({ message, parentId }),
		})
	}

	static async createSystemMessage(
		convId: string,
		systemPrompt: string,
		parentId: string
	): Promise<DatabaseMessage> {
		return api(`/conversations/${convId}/messages/system`, {
			method: 'POST',
			body: JSON.stringify({ systemPrompt, parentId }),
		})
	}

	static async updateMessage(
		id: string,
		updates: Partial<Omit<DatabaseMessage, 'id'>>
	): Promise<void> {
		await api(`/messages/${id}`, {
			method: 'PUT',
			body: JSON.stringify(updates),
		})
	}

	static async deleteMessage(messageId: string): Promise<void> {
		await api(`/messages/${messageId}`, { method: 'DELETE' })
	}

	static async deleteMessageCascading(
		conversationId: string,
		messageId: string
	): Promise<string[]> {
		return api(`/conversations/${conversationId}/messages/${messageId}/cascade`, {
			method: 'DELETE',
		})
	}

	// ── Import / Fork ──────────────────────────────────────────────────────────

	static async importConversations(
		data: { conv: DatabaseConversation; messages: DatabaseMessage[] }[]
	): Promise<{ imported: number; skipped: number }> {
		return api('/import', {
			method: 'POST',
			body: JSON.stringify(Array.isArray(data) ? data : [data]),
		})
	}

	static async forkConversation(
		sourceConvId: string,
		atMessageId: string,
		options: { name: string; includeAttachments: boolean }
	): Promise<DatabaseConversation> {
		return api(`/conversations/${sourceConvId}/fork`, {
			method: 'POST',
			body: JSON.stringify({ atMessageId, ...options }),
		})
	}
}
