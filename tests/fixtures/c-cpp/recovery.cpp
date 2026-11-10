#include "recovery.h"

LIB_BEGIN_NAMESPACE

class LIB_EXPORT Widget {
 public:
  LIB_CONSTEXPR int size() const { return size_; }
  void Lock() EXCLUSIVE_LOCKS_REQUIRED(mu_);
  bool empty() const { return size_ == 0; }

 private:
  int size_ GUARDED_BY(mu_);
};

template <typename T, LIB_ENABLE_IF(std::is_integral<T>::value)>
LIB_CONSTEXPR auto twice(T value) -> T {
  if LIB_CONSTEXPR20 (sizeof(T) > 4) return value + value;
  return value * 2;
}

int connect(int fd) {
#ifdef _WIN32
  if (fd == INVALID_SOCKET) {
#else
  if (fd < 0) {
#endif
    return -1;
  }
  return fd;
}

LIB_END_NAMESPACE
