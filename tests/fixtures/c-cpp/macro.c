#define API __attribute__((visibility("default")))
#define DECLARE_HANDLER(name) int name##_handler(int code)

API int api_call(void) { return 1; }

DECLARE_HANDLER(open) {
	return code + api_call();
}

#ifdef _WIN32
int platform(void) { return 1; }
#else
int platform(void) { return 2; }
#endif
