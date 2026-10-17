import { add } from "./helpers";

export function Total({ items }) {
	return (
		<ul className="total">
			{items.map((item) => (
				<li key={item.id}>{format(item.price)}</li>
			))}
			<li>Sum: {add(items.length, 1)}</li>
		</ul>
	);
}

function format(price) {
	return `$${price}`;
}

export const Badge = ({ label }) => <span className="badge">{label}</span>;

export default function App() {
	return <Total items={[]} />;
}
