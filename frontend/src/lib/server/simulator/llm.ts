import {
	PRIVATE_SIM_LLM_API_KEY,
	PRIVATE_SIM_LLM_BASE_URL,
	PRIVATE_SIM_LLM_ENABLED,
	PRIVATE_SIM_LLM_MODEL
} from '$lib/server/env';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatCompletionsResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Keep going with fenced extraction.
	}

	const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
	if (!fencedMatch) {
		return null;
	}

	try {
		const parsed = JSON.parse(fencedMatch[1]);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return null;
	}

	return null;
}

async function callOpenAICompatible(messages: ChatMessage[], temperature = 0.6) {
	const base = PRIVATE_SIM_LLM_BASE_URL.replace(/\/$/, '');
	const response = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${PRIVATE_SIM_LLM_API_KEY}`
		},
		body: JSON.stringify({
			model: PRIVATE_SIM_LLM_MODEL,
			messages,
			temperature
		})
	});

	if (!response.ok) {
		throw new Error(`LLM request failed with status ${response.status}.`);
	}

	const json = (await response.json()) as ChatCompletionsResponse;
	const content = json.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('LLM returned an empty response.');
	}

	return content;
}

export async function requestJsonDecision(
	messages: ChatMessage[],
	fallback: Record<string, unknown>
): Promise<{ payload: Record<string, unknown>; usedFallback: boolean; reason: string }> {
	if (!PRIVATE_SIM_LLM_ENABLED || !PRIVATE_SIM_LLM_API_KEY) {
		return {
			payload: fallback,
			usedFallback: true,
			reason: 'LLM disabled or missing API key'
		};
	}

	try {
		const content = await callOpenAICompatible(messages);
		const payload = extractJsonObject(content);
		if (!payload) {
			return {
				payload: fallback,
				usedFallback: true,
				reason: 'LLM output was not valid JSON object'
			};
		}

		return {
			payload,
			usedFallback: false,
			reason: 'LLM response parsed successfully'
		};
	} catch (error) {
		return {
			payload: fallback,
			usedFallback: true,
			reason: error instanceof Error ? error.message : 'Unknown LLM error'
		};
	}
}
