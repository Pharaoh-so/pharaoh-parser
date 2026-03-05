/**
 * Route incoming requests to the appropriate handler.
 */
export function routeRequest(path: string, method: string): string {
	if (method === "GET") {
		return `Handling GET ${path}`;
	}
	return `Handling ${method} ${path}`;
}

/**
 * Validate the request body before processing.
 */
export function validateRequest(body: unknown): boolean {
	return body !== null && body !== undefined;
}
