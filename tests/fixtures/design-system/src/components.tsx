// Destructured props with type annotation
export function Button({ variant, size, onClick }: ButtonProps): JSX.Element {
	return (
		// biome-ignore lint/a11y/useButtonType: test fixture
		<button onClick={onClick} className={variant}>
			{size}
		</button>
	);
}

// Opaque props (no destructuring)
export function Card(props: CardProps): JSX.Element {
	return <div>{props.children}</div>;
}

// No params at all
export function Divider(): JSX.Element {
	return <div />;
}

// Arrow function with destructured props
export const Input = ({ value, onChange, placeholder }: InputProps) => {
	return <input value={value} onChange={onChange} placeholder={placeholder} />;
};

// Arrow function with opaque props
export const Select = (props: SelectProps) => {
	return <select>{props.children}</select>;
};

// Multiple JSX intrinsics in one component
export function Form({ onSubmit, action }: FormProps): JSX.Element {
	return (
		<form onSubmit={onSubmit} action={action}>
			<input type="text" />
			<textarea rows={5} />
			<button type="submit">Go</button>
		</form>
	);
}

// JSX with non-curated elements only (div, span, etc.)
export function Layout({ children }: LayoutProps): JSX.Element {
	return (
		<div>
			<span>{children}</span>
		</div>
	);
}

// JSX with img and a (link)
export function MediaCard({ src, href }: MediaCardProps): JSX.Element {
	return (
		<div>
			{/* biome-ignore lint/a11y/useAltText: test fixture */}
			<img src={src} />
			<a href={href}>Link</a>
		</div>
	);
}

// Class method with destructured params
export class Dialog {
	render({ open, onClose }: DialogProps): JSX.Element {
		return (
			<dialog open={open}>
				{/* biome-ignore lint/a11y/useButtonType: test fixture */}
				<button onClick={onClose}>X</button>
			</dialog>
		);
	}
}

// No JSX at all
export function compute(x: number): number {
	return x * 2;
}

interface ButtonProps {
	variant: string;
	size: string;
	onClick: () => void;
}
interface CardProps {
	children: React.ReactNode;
}
interface InputProps {
	value: string;
	// biome-ignore lint/suspicious/noExplicitAny: test fixture
	onChange: (e: any) => void;
	placeholder: string;
}
interface SelectProps {
	children: React.ReactNode;
}
interface FormProps {
	onSubmit: () => void;
	action: string;
}
interface LayoutProps {
	children: React.ReactNode;
}
interface MediaCardProps {
	src: string;
	href: string;
}
interface DialogProps {
	open: boolean;
	onClose: () => void;
}
