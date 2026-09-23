import * as publicEnv from '$env/static/public';
import { parseBoolean } from '$lib/utils/parse-boolean';
import { dev } from '$app/environment';

const typedPublicEnv = publicEnv as Record<string, string | undefined>;
const DEFAULT_PUBLIC_POCKETBASE_URL = dev ? 'http://localhost:8090' : '/';

export const PUBLIC_POCKETBASE_URL =
	typedPublicEnv.PUBLIC_POCKETBASE_URL?.trim() || DEFAULT_PUBLIC_POCKETBASE_URL;

export const PUBLIC_API_DEBUG_LOGS = parseBoolean(typedPublicEnv.PUBLIC_API_DEBUG_LOGS);
export const PUBLIC_API_DEBUG_LOGS_BODY = parseBoolean(typedPublicEnv.PUBLIC_API_DEBUG_LOGS_BODY);
