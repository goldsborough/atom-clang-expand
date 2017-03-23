# :dragon: atom-clang-expand

<p align="center">
  <img src="https://github.com/goldsborough/clang-expand/raw/master/extra/clang-expand.gif">
  <br><br>
  An atom integration of <a href="https://github.com/goldsborough/clang-expand">clang-expand</a>.
</p>

Enables:

* `atom-clang-expand:expand`: Expands the function under the cursor (see above).
* `atom-clang-expand:unexpand`: Unexpands an expansion.
* `atom-clang-expand:unexpand-all`: Unexpands all expansions in the current file.
* `atom-clang-expand:go-to-declaration`: Goes to the declaration of the function under the cursor.
* `atom-clang-expand:go-to-definition`: Goes to the definition of the function under the cursor.
* `atom-clang-expand:show-declaration`: Displays the declaration of the function under the cursor in a widget.
* `atom-clang-expand:show-definition`: Displays the definition of the function under the cursor in a widget.

This package will watch out for a `.clang-expand` file at the root of your
project, in YAML format, with the following schema:

```yaml
---
sources: Single glob pattern
  - Or list of glob patterns
  - to find source files,
  - absolute or relative to the project root, e.g.:
  - src/**/*.cpp
  - Note that the root is always searched.

extra:
  - List of flags
  - to pass to the compiler
  - to compile your source files, e.g.:
  - -I/path/to/headers
  - -std=c++14
...
```
