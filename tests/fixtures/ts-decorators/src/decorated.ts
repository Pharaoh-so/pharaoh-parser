/**
 * Test fixture for TypeScript decorator patterns.
 *
 * Covers: class decorators, method decorators (simple, with args, stacked),
 * member-expression decorators, identifier-only decorators, and undecorated baselines.
 */

import { Controller, Get, Post } from "@nestjs/common";
import { Cached } from "./cache";
import { Injectable } from "./di";

// A namespace object used for member-expression decorators
declare const app: { route: (path: string) => MethodDecorator };

@Controller("/users")
class UserController {
	@Get()
	@Cached({ ttl: 60 })
	async getUsers(): Promise<unknown[]> {
		return [];
	}

	@Post()
	async createUser(body: unknown): Promise<unknown> {
		return body;
	}

	// Undecorated method — decorators should be undefined
	async healthCheck(): Promise<string> {
		return "ok";
	}
}

@Injectable
class UserService {
	@app.route("/process")
	async process(data: unknown): Promise<unknown> {
		return data;
	}
}

// Undecorated class — decorators should be undefined
class PlainHelper {
	format(value: string): string {
		return value.trim();
	}
}

// Exported decorated class — tests wiring through extractExportStatement
@Controller("/admin")
export class AdminController {
	@Get()
	async listAdmins(): Promise<unknown[]> {
		return [];
	}
}
