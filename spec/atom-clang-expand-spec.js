'use babel';

import AtomClangExpand from '../lib/atom-clang-expand';

// Use the command `window:run-package-specs` (cmd-alt-ctrl-p) to run specs.
//
// To run a specific `it` or `describe` block add an `f` to the front (e.g. `fit`
// or `fdescribe`). Remove the `f` to unfocus the block.

describe('AtomClangExpand', () => {
  let workspaceElement, activationPromise;

  beforeEach(() => {
    workspaceElement = atom.views.getView(atom.workspace);
    activationPromise = atom.packages.activatePackage('atom-clang-expand');
  });

  describe('when the atom-clang-expand:expand event is triggered', () => {
    it('hides and shows the modal panel', () => {
      // Before the activation event the view is not on the DOM, and no panel
      // has been created
      expect(workspaceElement.querySelector('.atom-clang-expand')).not.toExist();

      // This is an activation event, triggering it will cause the package to be
      // activated.
      atom.commands.dispatch(workspaceElement, 'atom-clang-expand:expand');

      waitsForPromise(() => {
        return activationPromise;
      });

      runs(() => {
        expect(workspaceElement.querySelector('.atom-clang-expand')).toExist();

        let atomClangExpandElement = workspaceElement.querySelector('.atom-clang-expand');
        expect(atomClangExpandElement).toExist();

        let atomClangExpandPanel = atom.workspace.panelForItem(atomClangExpandElement);
        expect(atomClangExpandPanel.isVisible()).toBe(true);
        atom.commands.dispatch(workspaceElement, 'atom-clang-expand:expand');
        expect(atomClangExpandPanel.isVisible()).toBe(false);
      });
    });

    it('hides and shows the view', () => {
      // This test shows you an integration test testing at the view level.

      // Attaching the workspaceElement to the DOM is required to allow the
      // `toBeVisible()` matchers to work. Anything testing visibility or focus
      // requires that the workspaceElement is on the DOM. Tests that attach the
      // workspaceElement to the DOM are generally slower than those off DOM.
      jasmine.attachToDOM(workspaceElement);

      expect(workspaceElement.querySelector('.atom-clang-expand')).not.toExist();

      // This is an activation event, triggering it causes the package to be
      // activated.
      atom.commands.dispatch(workspaceElement, 'atom-clang-expand:expand');

      waitsForPromise(() => {
        return activationPromise;
      });

      runs(() => {
        // Now we can test for view visibility
        let atomClangExpandElement = workspaceElement.querySelector('.atom-clang-expand');
        expect(atomClangExpandElement).toBeVisible();
        atom.commands.dispatch(workspaceElement, 'atom-clang-expand:expand');
        expect(atomClangExpandElement).not.toBeVisible();
      });
    });
  });
});
