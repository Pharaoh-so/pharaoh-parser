export class User {
	name: string;
	email: string;

	constructor(name: string, email: string) {
		this.name = name;
		this.email = email;
	}

	greet(): string {
		return `Hello, ${this.name}`;
	}

	async save(): Promise<void> {
		// stub
	}
}

export interface UserInput {
	name: string;
	email: string;
}
