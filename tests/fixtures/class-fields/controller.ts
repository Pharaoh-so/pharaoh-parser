import { Service } from "typedi";

declare function Log(): PropertyDecorator;

@Service()
export class ApiUserController {
	private readonly limit = 10;

	constructor(private readonly users: unknown) {}

	public createApiUser = async (req: unknown, _res: unknown): Promise<void> => {
		if (req) await this.save(req);
	};

	handleLegacy = function (this: ApiUserController, req: unknown): unknown {
		return req;
	};

	@Log()
	public deleteApiUser = (id: string): string => id;

	private async save(_input: unknown): Promise<void> {}
}
