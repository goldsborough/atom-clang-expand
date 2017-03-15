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
import child_process from 'child_process'; // eslint-disable-line camelcase
import yaml from 'yaml-js';

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
        'atom-clang-expand:go-to-definition': () => this.goToDefinition(),
        'atom-clang-expand:go-to-declaration': () => this.goToDeclaration(),
        'atom-clang-expand:show-definition': () => this.showDefinition(),
        'atom-clang-expand:show-declaration': () => this.showDeclaration(),
      }));

      this.watches.push(atom.workspace.onWillDestroyPaneItem(event => {
        const file = atom.workspace.getActiveTextEditor().getPath();
        if (file in self.expansions) {
          self.expansions[file].clear();
          delete self.expansions[file];
        }
      }));
  },

  deactivate() {
    this.watches.forEach(watch => watch.dispose());
    for (let file of Object.keys(this.expansions)) {
      this.expansions[file].clear();
    }
    this.subscriptions.dispose();
  },

  serialize() {
    return {};
  },

  globOptions(cwd, nodir) {
    return {
      cwd: cwd || this.root.getPath(),
      dot: false,
      nosort: true,
      silent: true,
      nodir: (nodir === undefined) ? true : nodir
    };
  },

  setupGuess() {
    const self = this;
    return new Promise(resolve => {
      if (self.hasGuess) resolve();

      self.hasGuess = true;
      const rootPath = self.root.getPath();
      const options = self.globOptions(rootPath, false);

      glob(`${rootPath}/@(include|inc|header?)/`, options, headerPaths => {
        // Always look for headers under root.
        self.flags.extra = ['', rootPath].concat(headerPaths).join(' -I');
        const basename = self.root.getBaseName();
        glob(`${rootPath}/*(src?|source?|${basename}|lib)/`, options, sourcePaths => {
          if (sourcePaths.length === 0) return;
          // Some projects like LLVM and clang have 'lib' as their source directory.
          // But most projects would have 'lib' as their directory for third party
          // code. So only pick 'lib' if none of the other options were found.
          if ('lib' in sourcePaths && sourcePaths.length > 1) {
            sourcePaths = sourcePaths.filter(path !== 'lib');
          }
          self.guessDirectory = new Directory(sourcePaths[0]);
          self.watches.push(self.guessDirectory.onDidChange(() => self.guessSources()));
        });
      });
    });
  },

  guessSources() {
    const self = this;
    return new Promise(resolve => {
      const options = self.globOptions();
      // Always look under root.
      glob('*.*(cpp|c|cc|cxx)', options, sources => {
        self.flags.sources = sources;
        if (self.guessDirectory) return;
        options.cwd = self.guessDirectory.getPath();
        glob('**/*.*(cpp|c|cc|cxx)', options, moreSources => {
          self.flags.sources.concat(moreSources);
        });
      });
    });
  },

  parseFlagsFile() {
    const self = this;
    return new Promise((resolve, reject) => {
      // read and parse and set sources and headers
      this.flagsFile.read(false).then(text => {
        try {
          // Insert newlines into code portions because LLVM outputs
          // strings in a way that does not respect newlines.
          const config = yaml.load(text);

          if (typeof config.sources === 'string') config.sources = [config.sources];
          if (typeof config.extra === 'string') config.extra = [config.extra];

          const options = self.globOptions();
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

  updateFlags() {
    const self = this;
    return new Promise(resolve => {
      self.flagsFile.exists().then(exists => {
        if (exists) {
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

  getCursorTriple() {
    const editor = atom.workspace.getActiveTextEditor();
    const position = editor.getCursorScreenPosition();
    // The position returned by the editor is 0-indexed, but clang needs
    // 1-indexed lines and columns.
    return {
      file: editor.getPath(),
      line: position.row + 1,
      column: position.column + 1,
    };
  },

  getCommand(cursor, options) {
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

  addError(message, detail) {
    console.error(message, detail);
    atom.notifications.addError(message, {
      detail
    });
  },

  parseResult(result) {
    try {
      // Insert newlines into code portions because LLVM outputs
      // strings in a way that does not respect newlines.
      result = result.replace(/'(.|\n)*?'/g, m => m.replace(/\n/g, '\\n').replace(/'/g, '"'));
      return yaml.load(result);
    } catch (error) {
      this.addError('Error parsing clang-expand result', error);
    }
  },

  goTo(location, message) {
    // Our (clang) locations are 1-indexed, but atom's are 0-indexed.
    atom.workspace.open(location.file, {
      initialLine: location.line - 1,
      initialColumn: location.column - 1,
    }).then(editor => {
      if (message) atom.notifications.addSuccess(message);
    });
  },

  show(code) {
    const editor = atom.workspace.getActiveTextEditor();
    const cursor = editor.getCursorBufferPosition();
    const marker = editor.markBufferPosition(cursor, {
      invalidate: 'touch'
    });
    editor.decorateMarker(marker, {
      type: 'overlay',
      onlyNonEmpty: true,
      item: new SourceView(code, () => marker.destroy())
    });
  },

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

  clangExpand(overrides, callback) {
    const self = this;
    this.updateFlags().then(() => {
      const options = self.getClangExpandOptions(overrides);
      const cursor = self.getCursorTriple();
      const command = self.getCommand(cursor, options);
      const execOptions = {
        cwd: self.root.getPath()
      };
      child_process.exec(command, execOptions, (error, stdout, stderr) => {
        if (error) {
          const message = self.cleanStderr(stderr);
          self.addError('Error executing clang-expand', message);
        } else {
          const result = self.parseResult(stdout);
          callback(result);
        }
      });
    });
  },

  goToDeclaration() {
    const self = this;
    this.clangExpand({
      declaration: true
    }, result => {
      self.goTo(result.declaration.location, 'Found Declaration');
    });
  },

  goToDefinition() {
    const self = this;
    this.clangExpand({
      definition: true
    }, result => {
      self.goTo(result.definition.location, 'Found Definition');
    });
  },

  showDeclaration() {
    const self = this;
    this.clangExpand({
      declaration: true
    }, result => self.show(result.declaration));
  },

  showDefinition() {
    const self = this;
    this.clangExpand({
      definition: true
    }, result => self.show(result.definition));
  },

  getActualTextRange(editor, range) {
    let copy = range.copy();

    editor.setCursorBufferPosition(range.start);
    editor.moveToFirstCharacterOfLine();
    copy.start = editor.getCursorBufferPosition();

    editor.setCursorBufferPosition(range.end);
    editor.moveToEndOfLine();
    editor.moveToPreviousWordBoundary();
    copy.end = editor.getCursorBufferPosition();

    return copy;
  },

  highlightRange(range) {
    const editor = atom.workspace.getActiveTextEditor();
    const textRange = this.getActualTextRange(editor, range);
    const marker = editor.markBufferRange(textRange, {
      invalidate: 'overlap'
    });
    editor.decorateMarker(marker, {
      type: 'line',
      onlyNonEmpty: true,
      class: 'clang-expand-highlight'
    });

    return marker;
  },

  selectCallRange(editor, call) {
    const range = new Range(
      new Point(call.begin.line - 1, call.begin.column - 1),
      new Point(call.end.line - 1, call.end.column)
    );
    editor.setSelectedBufferRange(range);
    return editor.getSelectedText();
  },

  activeExpansions() {
    const path = atom.workspace.getActiveTextEditor().getPath();
    let expansions = this.expansions[path];
    if (expansions === undefined) {
      expansions = this.expansions[path] = new ExpansionSet();
    }
    return expansions;
  },

  expand() {
    const editor = atom.workspace.getActiveTextEditor();
    // Save first, otherwise the locations will be wrong.
    editor.save();
    this.clangExpand({
      call: true,
      rewrite: true
    }, result => {
      const originalText = this.selectCallRange(editor, result.call);
      editor.transact(0, () => {
        const range = editor.insertText(result.definition.rewritten, {
          select: true
        });
        editor.selectToBeginningOfLine();
        editor.selectToEndOfLine();
        editor.autoIndentSelectedRows();
        const marker = this.highlightRange(range[0]);
        this.activeExpansions().add(marker, originalText);
      });
      atom.notifications.addSuccess('Expanded successfully');
    });
  },

  unexpand() {
    const editor = atom.workspace.getActiveTextEditor();
    const cursor = editor.getCursorBufferPosition();
    const expansion = this.activeExpansions().remove(cursor);
    if (!expansion) {
      atom.notifications.addError('Nothing to unexpand there');
      return;
    }

    expansion.unexpand(editor);

    atom.notifications.addSuccess('Unexpansion successful');
  }
};
