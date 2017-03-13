'use babel';

import clangExpand from './atom-clang-expand';

export default class SourceView {
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
    const file = atom.project.getDirectories()[0].relativize(result.location.file);
    link.innerHTML = `<a>${file}:${result.location.line}:${result.location.column}</a>`;
    this.element.appendChild(link);

    let self = this;
    this.element.onclick = () => {
      clangExpand.goTo(result.location);
      this.destroy();
    };

    this.element.onmouseleave = () => self.destroy();
    document.body.onkeydown = () => self.destroy();
  }

  destroy() {
    this.onDeath();
    this.element.remove();
  }

  getElement() {
    return this.element;
  }

}
