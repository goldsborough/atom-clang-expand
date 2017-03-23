'use babel';

import clangExpand from './atom-clang-expand';

/**
 * Widget displaying a snippet of source code and the file where that code
 * originates from.
 *
 * The widget dies when the user's mouse moves away from the widget (it is
 * initially on it) or the user presses any key.
 */
export default class SourceView {

  /**
   * Constructor, taking the result of clang-expand and a callback to invoke
   * when the widget is destroyed.
   */
  constructor(result, onDeath) {
    this.onDeath = onDeath;
    this.element = document.createElement('div');
    this.element.classList.add('clang-expand-source-view-container');

    const lines = result.text.split('\n');
    const code = document.createElement('div');
    code.classList.add('clang-expand-source-view-code');
    code.innerHTML = lines.map(line => `<span>${line}\n</span>`).join('\n');
    this.element.appendChild(code);

    if (lines.length >= 10) {
      code.classList.add('tens');
    }

    const link = document.createElement('div');
    link.classList.add('clang-expand-source-view-info');
    const location = result.location;
    const file = atom.project.getDirectories()[0].relativize(location.filename);
    link.innerHTML = `<a>${file}:${location.offset.line}:${location.offset.column}</a>`;
    this.element.appendChild(link);

    let self = this;
    this.element.onclick = () => {
      clangExpand.goTo(result.location);
      this.destroy();
    };

    this.element.onmouseleave = () => self.destroy();
    document.body.onkeydown = () => self.destroy();
  }

  /**
   * Kills the view, removing it from the DOM and invoking the `onDeath`
   * callback passed in the constructor.
   */
  destroy() {
    this.onDeath();
    this.element.remove();
  }

  /**
   * Returns the element of the source view.
   */
  getElement() {
    return this.element;
  }
}
