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
  expansions: new ExpansionSet(),

  activate(state) {
    const self = this;
    this.root = atom.project.getDirectories()[0];
    this.flagsFile = this.root.getFile('.clang-expand');
    this.watches.push(this.flagsFile.onDidChange(self.parseFlagsFile));

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
  },

  deactivate() {
    this.watches.forEach(watch => watch.dispose());
    this.subscriptions.dispose();
  },

  serialize() {
    // console.log(atom.config.get('atom-clang-expand.retain'));
    // if (!atom.config.get('atom-clang-expand.retain')) {
    //   for (expansion of this.expansions) {
    //     console.log(expansion);
    //     // unexpand(expansion)
    //   }
    //   // this.expansions = []
    //   // while (this.expansions.length > 0) this.expansions.pop();
    // }
    return {};
  },

  setupGuess() {
    this.hasGuess = true;
    const rootPath = this.root.getPath();
    const basename = this.root.getBaseName();

    const options = {
      dot: false,
      nosort: true,
      silent: true,
    };

    const headerPaths = glob.sync(`${rootPath}/@(include|inc|header?)/`, options);

    // Always look for headers under root.
    this.flags.extra = ['', rootPath].concat(headerPaths).join(' -I');

    let sourcePaths = glob.sync(
      `${rootPath}/*(src?|source?|${basename}|lib)/`,
      options
    );

    if (sourcePaths.length == 0) return;

    // Some projects like LLVM and clang have 'lib' as their source directory.
    // But most projects would have 'lib' as their directory for third party
    // code. So only pick 'lib' if none of the other options were found.
    if ('lib' in sourcePaths && sourcePaths.length > 1) {
      sourcePaths = sourcePaths.filter(path !== 'lib');
    }

    this.guessDirectory = new Directory(sourcePaths[0]);

    const self = this;
    this.watches.push(
      this.guessDirectory.onDidChange(() => self.guessSources));
  },

  guessSources() {
    console.log(this.root);
    console.log(this);
    const options = {
      cwd: this.root.getPath(),
      dot: false,
      nosort: true,
      silent: true,
      nodir: true,
    };
    this.flags.sources = glob.sync('*.*(cpp|c|cc|cxx)', options);
    if (this.guessDirectory) {
      options.cwd = this.guessDirectory.getPath();
      const sources = glob.sync('**/*.*(cpp|c|cc|cxx)', options);
      this.flags.sources.concat(sources);
    }
  },

  parseFlagsFile(changed) {
    // read and parse and set sources and headers
  },

  updateFlags() {
    if (!this.flagsFile.existsSync()) {
      if (!this.hasGuess) this.setupGuess();
      this.guessSources();
    }
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
    this.updateFlags();

    const executable = atom.config.get('atom-clang-expand.executable');
    const sources = this.flags.sources.join(' ');
    const extra = this.flags.extra + ` -I/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/../include/c++/v1 -I/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/../lib/clang/8.0.0/include -std=c++14`;

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
      console.log(result);
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
    console.log(code);
    const editor = atom.workspace.getActiveTextEditor();
    const cursor = editor.getCursorBufferPosition();
    const marker = editor.markBufferPosition(cursor, {invalidate: 'touch'});
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
    this.updateFlags();

    const options = this.getClangExpandOptions(overrides);

    const cursor = this.getCursorTriple();
    const command = this.getCommand(cursor, options);
    console.log(command);

    const execOptions = {cwd: this.root.getPath()};
    child_process.exec(command, execOptions, (error, stdout, stderr) => {
      if (error) {
        const message = this.cleanStderr(stderr);
        this.addError('Error executing clang-expand', message);
      } else {
        const result = this.parseResult(stdout);
        callback(result);
      }
    });
  },

  goToDeclaration() {
    const self = this;
    this.clangExpand({declaration: true}, result => {
      self.goTo(result.declaration.location, 'Found Declaration');
    });
  },

  goToDefinition() {
    const self = this;
    this.clangExpand({definition: true}, result => {
      self.goTo(result.definition.location, 'Found Definition');
    });
  },

  showDeclaration() {
    const self = this;
    this.clangExpand({declaration: true}, result => self.show(result.declaration));
  },

  showDefinition() {
    const self = this;
    this.clangExpand({definition: true}, result => self.show(result.definition));
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
    const marker = editor.markBufferRange(textRange, {invalidate: 'inside'});
    editor.decorateMarker(marker, {
      type: 'line',
      onlyNonEmpty: true,
      class: 'clang-expand-highlight'
    });

    return marker;
  },

  selectCallRange(editor, call) {
    console.log(call);
    const range = new Range(
      new Point(call.begin.line - 1, call.begin.column - 1),
      new Point(call.end.line - 1, call.end.column)
    );
    console.log(range);
    editor.setSelectedBufferRange(range);
    return editor.getSelectedText();
  },

  expand() {
    this.clangExpand({call: true, rewrite: true}, result => {
      console.log(result);
      const editor = atom.workspace.getActiveTextEditor();
      const original = this.selectCallRange(editor, result.call);
      let range = editor.insertText(result.definition.rewritten + '\n', {select: true});
      editor.selectToBeginningOfLine();
      editor.autoIndentSelectedRows();
      const marker = this.highlightRange(range[0]);

      this.expansions.add(range[0], marker, original);

      atom.notifications.addSuccess('Expanded successfully');
    });
  },

  unexpand() {

  },

};
