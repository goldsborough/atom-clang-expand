'use babel';

import clangExpand from './atom-clang-expand';

export default class SourceView {
  constructor(code, onDeath) {
    this.onDeath = onDeath;
    this.element = document.createElement('div');
    this.element.classList.add('clang-expand-source-view-container');

    const lines = code.text.split('\n').map(line => `<span>${line}</span>`).join('\n');
    this.element.innerHTML = `<div class="clang-expand-source-view-code">${lines}</div>`;

    const link = document.createElement('div');
    link.classList.add('clang-expand-source-view-info');
    const file = atom.project.getDirectories()[0].relativize(code.location.file);
    link.innerHTML = `<a>${file}:${code.location.line}:${code.location.column}</a>`;
    this.element.appendChild(link);

    let self = this;
    link.onclick = () => {
      clangExpand.goTo(code.location, 'Found Definition');
      this.destroy();
    };

    this.element.onmouseleave = () => self.destroy();
  }

  destroy() {
    this.onDeath();
    this.element.remove();
  }

  getElement() {
    return this.element;
  }

}
