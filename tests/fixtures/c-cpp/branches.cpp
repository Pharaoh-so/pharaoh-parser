#define LIMIT 8

class Port {
 public:
#ifdef _WIN32
  int handle() const { return 1; }
#else
  int fd() const { return 2; }
#endif
};

#ifdef _WIN32
int windows_api();
int win_only() { return 1; }
#else
int posix_api();
int posix_only() { return 2; }
#endif

int run(int fd) {
#ifdef _WIN32
  if (fd == 0) {
#else
  if (fd < 0) {
#endif
    return -1;
  }
  return fd;
}
