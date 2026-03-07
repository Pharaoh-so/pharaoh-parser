// TypeScript enum patterns

export enum Status {
	Active = "active",
	Inactive = "inactive",
	Pending = "pending",
}

export enum Direction {
	Up = 0,
	Down = 1,
	Left = 2,
	Right = 3,
}

enum InternalState {
	Loading = 0,
	Ready = 1,
	Error = 2,
}

export interface Config {
	status: Status;
	direction: Direction;
}

export function getStatus(): Status {
	return Status.Active;
}
