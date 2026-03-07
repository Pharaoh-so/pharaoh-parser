import React from "react";
import { add } from "./helpers";

function App() {
	const result = add(1, 2);
	return <div>Result: {result}</div>;
}

export default App;
