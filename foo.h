#include <vector>

inline int f(int x) {
  std::vector<int> v;
  v.emplace_back(v.size());
  for (
    int i = 0;
    i < 100;
    ++i
  ) {
    v.emplace_back(v.size() + i);
  }
  return x + 1;
}
