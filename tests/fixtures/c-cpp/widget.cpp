#include "export.h"

class lib_export Widget {
 public:
  int size() const { return size_; }

 private:
  int size_ = 0;
};
