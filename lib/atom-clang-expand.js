'use babel';

import {
  CompositeDisposable,
  Directory,
  Range,
  Point
} from 'atom';
import Config from './configuration.coffee';
import SourceView from './source-view';
import ExpansionSet from './expansion-set';

import glob from 'glob';
import yaml from 'yaml-js';
import child_process from 'child_process'; // eslint-disable-line camelcase
import commandExists from 'command-exists';

export default {
  config: Config.config,
  subscriptions: null,
  root: null,
  guessDirectory: null,
  hasGuess: false,
  watches: [],
  flags: {},
  flagsFile: null,
  notYetParsed: true,
  expansions: {},
  hasClangFormat: null,

  /**
   * Activates the package and is slow.
   */
  activate(state) {
    const self = this;
    this.root = atom.project.getDirectories()[0];
    this.flagsFile = this.root.getFile('.clang-expand');

    // Once the file starts to exist, we reparse asynchronously.
    // That way we don't have to parse when calling clang-expand anymore.
    this.watches.push(this.flagsFile.onDidChange(() => self.parseFlagsFile()));

    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(atom.commands.add(
      'atom-workspace', {
        'atom-clang-expand:expand': () => this.expand(),
        'atom-clang-expand:unexpand': () => this.unexpand(),
        'atom-clang-expand:unexpand-all': () => this.unexpandAll(),
        'atom-clang-expand:go-to-definition': () => this.goToDefinition(),
        'atom-clang-expand:go-to-declaration': () => this.goToDeclaration(),
        'atom-clang-expand:show-definition': () => this.showDefinition(),
        'atom-clang-expand:show-declaration': () => this.showDeclaration(),
      }));
  },

  /**
   * Deactivates the package and disposes subscriptions.
   */
  deactivate() {
    this.watches.forEach(watch => watch.dispose());
    this.subscriptions.dispose();
  },

  /**
   * Does nothing.
   * We don't serialize anything because serializing expansions is too brittle.
   */
  serialize() {
    return {};
  },

  /**
   * Returns an object of glob options.
   *
   * @param {String} cwd The working directory to use for globbing.
   * @param {Boolean=} Whether to exclude directories from glob results
   *                   (defaults to true).
   */
  globOptions(cwd, nodir) {
    return {
      cwd: cwd || this.root.getPath(),
      dot: false,
      nosort: true,
      silent: true,
      nodir: (nodir === undefined) ? true : nodir
    };
  },

  /**
   * Sets up our guessing efforts.
   *
   * If no configuration file (`.clang-expand`) is found, we try our best to
   * find headers and sources ourselves. We do this by globbing for `.cpp/.c`
   * and `.h/.hpp` files under folders that are likely to contain them, like
   * `include`, `source`, `src` and so on.
   */
  setupGuess() {
    const self = this;
    return new Promise(resolve => {
      if (self.hasGuess) resolve();

      self.hasGuess = true;
      const rootPath = self.root.getPath();
      const options = self.globOptions(rootPath, false);

      // Asynchronous all the things.
	glob(`${rootPath}/@(include|inc|header?)/`, options, (error, headerPaths) => {
        // Always look for headers under root.
        self.flags.extra = ['', rootPath].concat(headerPaths).join(' -I');

        const basename = self.root.getBaseName();
        glob(`${rootPath}/*(src?|source?|${basename}|lib)/`,
             options, (error, sourcePaths) => {
            if (!sourcePaths || sourcePaths.length === 0) return;
            // Some projects like LLVM and clang have 'lib' as their source
            // directory. But most projects would have 'lib' as their directory
            // for third party code. So only pick 'lib' if none of the other
            // options were found.
            if ('lib' in sourcePaths && sourcePaths.length > 1) {
              sourcePaths = sourcePaths.filter(path !== 'lib');
            }
            self.guessDirectory = new Directory(sourcePaths[0]);
            self.watches.push(
              self.guessDirectory.onDidChange(() => self.guessSources()));
          });
      });
    });
  },

  /**
   * Does the actual guesswork, globbing in the guess folders found in
   * `setupGuess`
   */
  guessSources() {
    const self = this;
    return new Promise(resolve => {
      const options = self.globOptions();
      // Always look under root.
      glob('*.*(cpp|c|cc|cxx)', options, (error, sources) => {
        self.flags.sources = sources;
        if (!self.guessDirectory) {
          resolve();
          return;
        }
        options.cwd = self.guessDirectory.getPath();
        glob('**/*.*(cpp|c|cc|cxx)', options, (error, moreSources) => {
          self.flags.sources.concat(moreSources);
          resolve();
        });
      });
    });
  },

  /**
   * Reads, parses and interprets the `.clang-expand` file.
   *
   * The `.clang-expand` file may contain:
   * 1. `sources` : A single/list of string(s) of glob patterns.
   * 2. `extra`: A single/list of strings specifying extra options to pass to
   * the compiler after the `--`.
   */
  parseFlagsFile() {
    const self = this;
    return new Promise((resolve, reject) => {
      // Read and parse and set sources and headers.
      this.flagsFile.read(/*flushCache=*/true).then(text => {
        try {
          const config = yaml.load(text);

          // We allow both single strings or lists of strings for both settings.
          if (typeof config.sources === 'string') {
            config.sources = [config.sources];
          }
          if (typeof config.extra === 'string') {
            config.extra = [config.extra];
          }

          const options = self.globOptions();

          // Map each glob pattern to an array of matching files, then reduce by
          // concateantin all those arrays into one.
          self.flags.sources = config.sources
            .map(pattern => glob.sync(pattern, options))
            .reduce((left, right) => left.concat(right));

          self.flags.extra = config.extra.join(' ');
          resolve();
        } catch (error) {
          self.addError(`Error reading ${self.flagsFile.getBaseName()}`, error);
          reject();
        }
      });
    });
  },

  /**
   * Updates the flags file, mostly dealing with the first update.
   * We also make sure that if the configuration file starts existing after
   * activation, we pick that up (i.e. don't have to reload the window).
   */
  updateFlags() {
    const self = this;
    return new Promise(resolve => {
      self.flagsFile.exists().then(exists => {
        if (exists) {
          // We've installed a `onDidChange` subscription on the config file, so
          // we only have to explicitly parse the first time, because no change
          // is triggered. From then on, things are asynchronous.
          if (self.notYetParsed) {
            self.parseFlagsFile().then(resolve);
            self.notYetParsed = false;
          } else {
            resolve();
          }
        } else {
          self.setupGuess().then(() => self.guessSources().then(resolve));
        }
      });
    });
  },

  /**
   * Gets the (file, line, column) triple at the current cursor position.
   */
  getCursorTriple() {
    const editor = atom.workspace.getActiveTextEditor();
    const position = editor.getCursorBufferPosition();
    // The position returned by the editor is 0-indexed, but clang needs
    // 1-indexed lines and columns.
    return {
      file: editor.getPath(),
      line: position.row + 1,
      column: position.column + 1,
    };
  },

  /**
   * Assembles the shell command to execute to invoke clang expand for a
   * particular query.
   */
  assembleCommand(cursor, options) {
    const executable = atom.config.get('atom-clang-expand.executable');
    const sources = this.flags.sources.join(' ');
    const extra = this.flags.extra;

    let flags = `-file=${cursor.file} `;
    flags += `-line=${cursor.line} `;
    flags += `-column=${cursor.column}`;

    for (const option of ['call', 'rewrite', 'declaration', 'definition']) {
      if (option in options) {
        flags += ` -${option}=${options[option]}`;
      }
    }

    return `${executable} ${flags} ${sources} -- ${extra}`;
  },

  /**
   * Utility function to simplify adding an error notification to Atom.
   */
  addError(message, detail) {
    console.error(message, detail);
    atom.notifications.addError(message, {detail});
  },

  /**
   * Parses the JSON output of `clang-expand` into a JavaScript object.
   */
  parseResult(result) {
    try {
      return JSON.parse(result);
    } catch (error) {
      this.addError('Error parsing clang-expand result', error);
    }
  },

  /**
   * Moves the user's cursor to a particular location (as a `(file, line,
   * column)` triple) and prints a notification message.
   */
  goTo(locationTriple, message) {
    // Our (clang) locations are 1-indexed, but atom's are 0-indexed.
    atom.workspace.open(locationTriple.filename, {
      initialLine: locationTriple.offset.line - 1,
      initialColumn: locationTriple.offset.column - 1,
    }).then(editor => {
      if (message) atom.notifications.addSuccess(message);
    });
  },

  /**
   * Displays a snippet of code in a custom view.
   */
  show(code) {
    const editor = atom.workspace.getActiveTextEditor();
    const cursor = editor.getCursorBufferPosition();
    const marker = editor.markBufferPosition(cursor, {invalidate: 'touch'});
    editor.decorateMarker(marker, {
      type: 'overlay',
      onlyNonEmpty: true,
      item: new SourceView(code, () => marker.destroy())
    });
  },

  /**
   * Cleans clang's/clang-expand's `stderr` output and returns a message with
   * the errors if there were any, else the original `stderr`, but without
   * warnings.
   */
  cleanStderr(stderr) {
    // Get rid of warnings
    stderr = stderr.replace(/warning:.*/, '');

    // If the code has syntax errors, clang will emit compilation errors.
    const errors = stderr.match(/error:.*/);

    // Errors may be null if there were no errors, in which case clang-expand
    // just reported an issue (e.g. no token at location) and returned with a
    // non-zero exit code. In that case stderr is actually what we want.
    return errors ? errors.join('\n') : stderr;
  },

  /**
   * Returns an object of options for clang-expand determining which parts of
   * clang-expand's complete result it will return(i.e. call range,
   * declaration data, rewritten data etc.).
   *
   * By default, all options (`call`, `declaration` etc.) are turned off. To
   * change this, this function takes an object of overrides, mapping these
   * names to booleans.
   */
  getClangExpandOptions(overrides) {
    let options = {
      call: false,
      declaration: false,
      definition: false,
      rewrite: false
    };

    for (const key in overrides) {
      if (overrides.hasOwnProperty(key)) {
        options[key] = overrides[key];
      }
    }

    return Object.freeze(options);
  },

  /**
   * Invokes clang-expand.
   *
   * Takes overrides for clang-expand options as well as a callback to execute
   * asynchronously with the resulting, parsed JSON (i.e. a JavaScript object).
   *
   * @see getClangExpandOptions()
   */
  clangExpand(overrides, callback) {
    const self = this;
    this.updateFlags().then(() => {
      const options = self.getClangExpandOptions(overrides);
      const cursor = self.getCursorTriple();
      const command = self.assembleCommand(cursor, options);
      const execOptions = {cwd: self.root.getPath()};
      console.log(command);
      child_process.exec(command, execOptions, (error, stdout, stderr) => {
        if (error) {
          const message = self.cleanStderr(stderr);
          self.addError('Error executing clang-expand', message);
        } else {
          callback(self.parseResult(stdout));
        }
      });
    });
  },

  /**
   * The `go-to-declaration` command. Jumps to the declaration of a function.
   */
  goToDeclaration() {
    const self = this;
    this.clangExpand({
      declaration: true
    }, result => {
      self.goTo(result.declaration.location, 'Found Declaration');
    });
  },

  /**
   * The `go-to-definition` command. Jumps to the definition of a function.
   */
  goToDefinition() {
    const self = this;
    this.clangExpand({
      definition: true
    }, result => {
      self.goTo(result.definition.location, 'Found Definition');
    });
  },

  /**
   * The `show-declaration` command. Displays the declaration source of a
   * function in a widget.
   */
  showDeclaration() {
    const self = this;
    this.clangExpand({
      declaration: true
    }, result => self.show(result.declaration));
  },

  /**
   * The `show-definition` command. Displays the definition source of a
   * function in a widget.
   */
  showDefinition() {
    const self = this;
    this.clangExpand({
      definition: true
    }, result => self.show(result.definition));
  },

  /**
   * Highlights a range in the editor visually.
   */
  highlightSelectedRange(editor) {
    const range = editor.getSelectedBufferRange();
    const marker = editor.markBufferRange(range, {invalidate: 'inside'});
    editor.decorateMarker(marker, {
      type: 'line',
      class: 'clang-expand-highlight'
    });

    return marker;
  },

  /**
   * Converts a range returned by clang-expand to an Atom range.
   *
   * Clang is 1-indexed, Atom is 0-indexed.
   */
  toAtomRange(call) {
    return new Range(
      new Point(call.begin.line - 1, call.begin.column - 1),
      new Point(call.end.line - 1, call.end.column)
    );
  },

  /**
   * Selects the 'call range' returned by clang-expand and returns the text in
   * that range.
   */
  selectCallRange(editor, range) {
    editor.setSelectedBufferRange(range);
    return editor.getSelectedText();
  },

  /**
   * Gets the expansion set for the currently active editor. If there is no
   * expansion set for this editor yet, a new one is created and returned.
   */
  getActiveExpansions() {
    const path = atom.workspace.getActiveTextEditor().getPath();
    let expansions = this.expansions[path];
    if (expansions === undefined) {
      expansions = this.expansions[path] = new ExpansionSet();
    }
    return expansions;
  },

  maybeFormat(text) {
    if (this.hasClangFormat === null) {
      this.hasClangFormat = commandExists.sync('clang-format');
    }
    if (this.hasClangFormat) {
      return child_process.execFileSync('clang-format', {
        input: text,
        encoding: 'utf8'
      });
    }
    return text;
  },

  /**
   * DIY indentation.
   *
   * Given that there is a selection, this function will figure out the
   * necessary indentation by auto-indenting the first line, determining the
   * level and then indenting subsequent lines by that level as well. This is
   * because Atom's auto-indentation does not understand C++ scoping rules if
   * there aren't explicit braces.
   */
  indentLines(editor, callRange) {
    const range = editor.getSelectedBufferRange();

    editor.setCursorBufferPosition(range.start);
    editor.selectToEndOfLine();
    editor.autoIndentSelectedRows();
    let level = editor.indentationForBufferRow(range.start.row);
    editor.undo();
    editor.setSelectedBufferRange(range);
    while (level-- > 0) editor.indentSelectedRows();
  },

  /**
   * Tests if the expression in the given range is 'full'.
   *
   * Full means that it is not part of some other statement, like `x` in `return
   * x`.
   */
  isFullExpression(editor, range) {
    if (range.start.row != range.end.row) return true;

    const previouslySelectedRange = editor.getSelectedBufferRange();

    let isFull = true;

    editor.setCursorBufferPosition(range.start);
    editor.moveToBeginningOfLine();
    editor.moveToNextWordBoundary();
    if (range.start.column != editor.getCursorBufferPosition().column) {
      isFull = false;
    } else {
      editor.moveToEndOfLine();
      isFull = range.end.column == editor.getCursorBufferPosition().column;
    }

    editor.setSelectedBufferRange(previouslySelectedRange);

    return isFull;
  },

  /**
   * Sets the start of a selection to column 0.
   *
   * `editor.selectToBeginningOfLine()` will just select backwards and screw
   * everything up.
   */
  selectToStartOfLine(editor) {
    let range = editor.getSelectedBufferRange();
    range.start.column = 0;
    editor.setSelectedBufferRange(range);
  },

  /**
   * The `expand` command. Attempts to expand the function under the user's
   * cursor.
   */
  expand() {
    const editor = atom.workspace.getActiveTextEditor();
    // Save first, otherwise the locations will be wrong.
    editor.save();
    this.clangExpand({call: true, rewrite: true}, result => {
      console.log(result);
      editor.transact(0, () => {
        const rewritten = this.maybeFormat(result.definition.rewritten);
        const callRange = this.toAtomRange(result.call);
        const originalLocation = editor.getCursorBufferPosition();
        const originalText = this.selectCallRange(editor, callRange);
        if (this.isFullExpression(editor, callRange)) {
          this.selectToStartOfLine(editor);
          editor.insertText(rewritten, {select: true});
          this.indentLines(editor, callRange);
        } else {
          editor.insertText(rewritten, {select: true});
        }
        const marker = this.highlightSelectedRange(editor);
        this.getActiveExpansions().add(marker, originalText, originalLocation);
      });

      atom.notifications.addSuccess('Expanded successfully');
    });
  },

  /**
   * The `unexpand` command. Attempts to unexpand the expansion under the user's
   * cursor.
   */
  unexpand() {
    const editor = atom.workspace.getActiveTextEditor();
    const cursor = editor.getCursorBufferPosition();
    const expansion = this.getActiveExpansions().remove(cursor);
    if (!expansion) {
      atom.notifications.addError('Nothing to unexpand there');
      return;
    }
    expansion.unexpand(editor);
    atom.notifications.addSuccess('Unexpansion successful');
  },

  /**
   * The `unexpand-all` command. Attempts to unexpand all expansions in the
   * current file.
   */
  unexpandAll() {
    const editor = atom.workspace.getActiveTextEditor();
    const path = editor.getPath();
    if (path in this.expansions) {
      this.expansions[path].clear();
      delete this.expansions[path];
      atom.notifications.addSuccess('Undid all expansions');
    }
  }
};
