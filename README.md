# gemini-code-editor README

This is the README for your extension "gemini-code-editor". After writing up a brief description, we recommend including the following sections.

Built with Gemini 2.5 pro: https://deepmind.google/models/gemini/pro/

## Setup
- Run or Debug extension
- if debugging, select open anyway. this opens your Extension Development Host (EDH) window
- in new window Cmd + Shift + P. Gemini: Edit Codebase
- Add Gemini API Key : Code > Settings > Settings > Gemini Code Editor

## Debug
Webview Developer Tools (for src/webview/script.js logs):
- Action: In the Extension Development Host (EDH) window (the one that pops up when you press F5 or run your launch configuration):
- Make sure your extension is activated and the webview panel ("Gemini: Edit Codebase") is visible.
- Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).
- Type and select: Developer: Open Webview Developer Tools.
- A new window will pop up. This is the DevTools for your webview panel specifically.
- Go to the "Console" tab in this new DevTools window.

### Refresh
- to refresh the code, in EDM > Ctrl + shift + P > Developer: reload window
- Make sure to close the 'watch' terminal when finishing debugging to ensure now code is used.
- changes are compiled automatically on save



## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
