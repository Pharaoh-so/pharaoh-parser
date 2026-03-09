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
