import { env as privateEnv } from '$env/dynamic/private';
import { parseBoolean } from '$lib/utils/parse-boolean';

const DEFAULT_PRIVATE_POCKETBASE_URL = 'http://pocketbase:8090';

function parseIntOrFallback(value: string | undefined, fallback: number) {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return parsed;
}

export const PRIVATE_POCKETBASE_URL =
	privateEnv.PRIVATE_POCKETBASE_URL?.trim() || DEFAULT_PRIVATE_POCKETBASE_URL;

// Debug log flags
export const PRIVATE_API_DEBUG_LOGS = parseBoolean(privateEnv.PRIVATE_API_DEBUG_LOGS);
export const PRIVATE_API_DEBUG_LOGS_BODY = parseBoolean(privateEnv.PRIVATE_API_DEBUG_LOGS_BODY);

// Simulator logic flags
export const PRIVATE_SIM_LLM_ENABLED =
	privateEnv.PRIVATE_SIM_LLM_ENABLED !== undefined
		? parseBoolean(privateEnv.PRIVATE_SIM_LLM_ENABLED)
		: true;

export const PRIVATE_SIM_LLM_BASE_URL =
	privateEnv.PRIVATE_SIM_LLM_BASE_URL?.trim() ||
	privateEnv.SIM_LLM_API_BASE?.trim() ||
	'https://models.github.ai/inference';

export const PRIVATE_SIM_LLM_MODEL =
	privateEnv.PRIVATE_SIM_LLM_MODEL?.trim() ||
	privateEnv.SIM_LLM_MODEL?.trim() ||
	'openai/gpt-4.1-mini';

export const PRIVATE_SIM_LLM_API_KEY =
	privateEnv.PRIVATE_SIM_LLM_API_KEY?.trim() ||
	privateEnv.GH_MODELS_TOKEN?.trim() ||
	privateEnv.GITHUB_TOKEN?.trim() ||
	privateEnv.SIM_LLM_API_KEY?.trim() ||
	'';

export const PRIVATE_SIM_USER_PASSWORD =
	privateEnv.PRIVATE_SIM_USER_PASSWORD?.trim() || 'sim-local-password-123';

export const PRIVATE_PB_SUPERUSER_EMAIL =
	privateEnv.PRIVATE_PB_SUPERUSER_EMAIL?.trim() || privateEnv.PB_SUPERUSER_EMAIL?.trim() || '';

export const PRIVATE_PB_SUPERUSER_PASSWORD =
	privateEnv.PRIVATE_PB_SUPERUSER_PASSWORD?.trim() ||
	privateEnv.PB_SUPERUSER_PASSWORD?.trim() ||
	'';

const PRIVATE_SIM_PLAYBACK_MAX_STEPS = Math.max(
	1,
	parseIntOrFallback(privateEnv.PRIVATE_SIM_PLAYBACK_MAX_STEPS, 25)
);
