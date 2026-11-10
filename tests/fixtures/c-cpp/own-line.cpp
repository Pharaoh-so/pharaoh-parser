class Box {
 public:
  FMT_CONSTEXPR20
  int size() const { return 1; }
};

const char* tag() { return "FMT_CONSTEXPR20 LUAI_FUNC"; }
LUAI_FUNC int broken(void) {
  return 0;
}
#if X
int split(void) {
#else
int split(void) { int y;
#endif
  return 1;
}
