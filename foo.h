#include <vector>

int ret() {
  return 42;
}

inline int f(int x) {
  std::vector<int> v;
  for (
    int i = 0;
    i < 100;
    ++i
  ) {
    v.emplace_back(v.size() + i);
  }
  return x + 1;
}
