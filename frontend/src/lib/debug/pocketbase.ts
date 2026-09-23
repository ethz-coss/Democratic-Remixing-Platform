import PocketBase, { ClientResponseError, type SendOptions } from 'pocketbase';

type DebugContext = 'server' | 'browser';

interface ConfigurePocketBaseDebugOptions {
	enabled: boolean;
	includeBody?: boolean;
	context: DebugContext;
}

type PocketBaseWithDebug = PocketBase & { __apiDebugInstalled?: boolean };

function stringifyBody(body: unknown) {
	if (!body) {
		return undefined;
	}

	if (typeof body === 'string') {
		return body.slice(0, 2000);
	}

	if (body instanceof URLSearchParams) {
		return body.toString().slice(0, 2000);
	}

	try {
		return JSON.stringify(body).slice(0, 2000);
	} catch {
		return '[unserializable body]';
	}
}

function getMethod(options?: SendOptions) {
	const rawMethod = options?.method;
	return typeof rawMethod === 'string' && rawMethod.trim() ? rawMethod.toUpperCase() : 'GET';
}

function getErrorMeta(err: unknown) {
	if (err instanceof ClientResponseError) {
		return {
			status: err.status,
			message: err.message,
			url: err.url || undefined
		};
	}

	if (err instanceof Error) {
		return { message: err.message };
	}

	return { message: String(err) };
}

export function configurePocketBaseDebug(pb: PocketBase, options: ConfigurePocketBaseDebugOptions) {
	const target = pb as PocketBaseWithDebug;
	if (!options.enabled || target.__apiDebugInstalled) {
		return pb;
	}

	target.__apiDebugInstalled = true;
	const originalSend = pb.send.bind(pb);

	pb.send = async (path: string, sendOptions?: SendOptions) => {
		const startedAt = Date.now();
		const method = getMethod(sendOptions);
		const body = options.includeBody ? stringifyBody(sendOptions?.body) : undefined;
		const prefix = `[pb:${options.context}]`;

		if (body) {
			console.info(`${prefix} ${method} ${path}`, { body });
		} else {
			console.info(`${prefix} ${method} ${path}`);
		}

		try {
			const result = await originalSend(path, sendOptions ?? {});
			console.info(`${prefix} ${method} ${path} -> OK (${Date.now() - startedAt}ms)`);
			return result;
		} catch (err) {
			console.error(
				`${prefix} ${method} ${path} -> ERROR (${Date.now() - startedAt}ms)`,
				getErrorMeta(err)
			);
			throw err;
		}
	};

	return pb;
}
