// Exported string constant
export const PRIMARY = "#1a1a2e";

// Exported number constant
export const MAX_RETRIES = 3;

// Exported object (value should be null — not scalar)
export const config = { theme: "dark", debug: false };

// Exported array (value should be null — not scalar)
export const COLORS = ["red", "green", "blue"];

// Non-exported (internal) constant
const INTERNAL_KEY = "secret-key-123";

// Exported constant with type annotation
export const API_URL: string = "https://api.example.com";

// Exported constant with complex type annotation
export const HEADERS: Record<string, string> = {
	"Content-Type": "application/json",
};

// Template literal without interpolation
// biome-ignore lint/style/noUnusedTemplateLiteral: intentional test fixture
export const GREETING = `Hello World`;

// Template literal WITH interpolation (should be value: null)
const name = "test";
export const MESSAGE = `Hello ${name}`;

// Arrow function constant (should NOT appear in constants — it's a function)
export const helper = () => "help";

// Very long string (>128 chars, should be value: null)
export const LONG_VALUE =
	"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// new expression (value: null)
export const instance = new Map();

// Call expression (value: null)
export const timestamp = Date.now();

// as const on scalar (should unwrap and extract value)
export const API_VERSION = "v2" as const;

// as const on array (value: null — not scalar)
export const SIZES = ["sm", "md", "lg"] as const;

// let should NOT appear in constants
// biome-ignore lint/style/useConst: intentional test fixture — testing let exclusion
// biome-ignore lint/style/useSingleVarDeclarator: intentional test fixture
let mutableVal = "x",
	anotherVal = "y";
export { mutableVal, anotherVal };

// Secret-named constants — should be skipped by parser (defense-in-depth)
export const DATABASE_PASSWORD = "hunter2";
export const STRIPE_SECRET_KEY = "sk_test_abc123";
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
export const AUTH_TOKEN = "eyJhbGciOiJIUzI1NiJ9";
export const API_KEY = "pk_live_xxx";
export const JWT_CREDENTIAL = "my-credential-value";
// Non-secret constants that happen to contain partial matches should be KEPT
export const KEYBOARD_SHORTCUT = "Ctrl+K";
export const TOKEN_LIMIT = 4096;
export const SECRET_SAUCE_RECIPE = "tomato";
