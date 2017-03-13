'use babel';

import {
  CompositeDisposable,
  Directory
} from 'atom';
import Config from './configuration.coffee';
import SourceView from './source-view'

import glob from 'glob';
import child_process from 'child_process'; // eslint-disable-line camelcase
import yaml from 'js-yaml';

export default {
  config: Config.config,
  subscriptions: null,
  root: null,
  guessDirectory: null,
  hasGuess: false,
  watches: [],
  flags: {},
  flagsFile: null,

  activate(state) {
    this.expansions = state;

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
      this.guessDirectory.onDidChange(self.guessSources));
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

  expand() {
    this.updateFlags();
  },

  unexpand() {

  },

  getCommand(cursor, options) {
    this.updateFlags();

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
      return yaml.load(result);
    } catch (error) {
      this.addError('Error parsing clang-expand result', error);
    }
  },

  blinkCurrentLine(editor) {
    // editor.selectLinesContainingCursors();
    // const range = editor.getSelectedBufferRange();
    // const marker = editor.markBufferRange(range);
    // editor.decorateMarker(marker, {
    //   type: 'line',
    //   class: 'clang-expand-highlight',
    //   onlyNonEmpty: true
    // });
  },

  goTo(location, message) {
    // Our (clang) locations are 1-indexed, but atom's are 0-indexed.
    atom.workspace.open(location.file, {
      initialLine: location.line - 1,
      initialColumn: location.column - 1,
    }).then(editor => {
      atom.notifications.addSuccess(message);
    });
  },

  show(code) {
    console.log(code);
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

  clangExpand(callback, options) {
    const cursor = this.getCursorTriple();
    const command = this.getCommand(cursor, options);
    const execOptions = {
      cwd: this.root.getPath()
    };
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
    this.clangExpand(result => self.goTo(result.declaration.location, 'Found Declaration'), {
      call: false,
      definition: false,
      rewrite: false
    });
  },

  goToDefinition() {
    const self = this;
    this.clangExpand(result => self.goTo(result.definition.location, 'Found Definition'), {
      call: false,
      declaration: false,
      rewrite: false
    });
  },

  showDeclaration() {
    const self = this;
    this.clangExpand(result => self.show(result.declaration), {
      call: false,
      definition: false,
      rewrite: false
    });
  },

  showDefinition() {
    const self = this;
    this.clangExpand(result => self.show(result.definition), {
      call: false,
      declaration: false,
      rewrite: false
    });
  }

};
